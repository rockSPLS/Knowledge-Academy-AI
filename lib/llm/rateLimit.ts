import "server-only";
import {
  EVALUATION_LIMIT_GLOBAL,
  EVALUATION_LIMIT_PER_IP,
  RATE_LIMIT_GLOBAL,
  RATE_LIMIT_GLOBAL_WINDOW_MS,
  RATE_LIMIT_PER_IP,
  RATE_LIMIT_PER_IP_WINDOW_MS,
  REVIEW_LIMIT_GLOBAL,
  REVIEW_LIMIT_PER_IP,
  SEARCH_LIMIT_GLOBAL,
  SEARCH_LIMIT_PER_IP,
} from "./limits";

// «Мягкий» лимит частоты запросов к модели: счётчики в памяти сервера.
// На хостинге экземпляров сервера несколько, у каждого свои счётчики, а после
// перезапуска счёт начинается заново — поэтому лимит приблизительный.
// Единый для всех экземпляров счётчик по IP — правило Firewall на хостинге, потолок расходов —
// в кабинете сервиса модели (см. docs/decisions-log.md).

export type RateLimitResult = { ok: true } | { ok: false; retryAfterSec: number };

// Сколько ключей держим в памяти. Если запросы идут с огромного числа разных IP,
// самые старые окна забываются — лимит и так «мягкий», а память не растёт
const MAX_KEYS = 10_000;

// Фиксированное окно: первый запрос открывает окно на windowMs, дальше считаем
// запросы до limit; когда окно истекло, счёт начинается заново
function createRateLimiter(limit: number, windowMs: number) {
  // Map хранит ключи в порядке добавления. Новое окно всегда добавляется в конец
  // (delete + set), поэтому окна упорядочены по времени истечения: чистка идёт
  // с начала и останавливается на первом живом окне
  const windows = new Map<string, { count: number; resetAt: number }>();

  return function consume(key: string, now = Date.now()): RateLimitResult {
    for (const [k, w] of windows) {
      if (w.resetAt > now && windows.size < MAX_KEYS) break;
      windows.delete(k);
    }

    const current = windows.get(key);
    if (!current || current.resetAt <= now) {
      windows.delete(key);
      windows.set(key, { count: 1, resetAt: now + windowMs });
      return { ok: true };
    }
    if (current.count >= limit) {
      return { ok: false, retryAfterSec: Math.ceil((current.resetAt - now) / 1000) };
    }
    current.count++;
    return { ok: true };
  };
}

// Независимые лимиты: генерация путешествия, оценка свободных ответов, поиск по материалам
// и разбор ошибок.
// У каждого — счётчик по IP и общий на экземпляр; окна одинаковые
function createModelLimit(perIpLimit: number, globalLimit: number) {
  const perIp = createRateLimiter(perIpLimit, RATE_LIMIT_PER_IP_WINDOW_MS);
  const allClients = createRateLimiter(globalLimit, RATE_LIMIT_GLOBAL_WINDOW_MS);
  return function consume(request: Request): RateLimitResult {
    const byIp = perIp(rateLimitKey(clientIp(request)));
    if (!byIp.ok) return byIp;
    return allClients("all");
  };
}

// IP посетителя. На Vercel заголовок x-forwarded-for выставляет платформа
// (значение от клиента перезаписывается). На других хостингах его можно подделать,
// а локально его может не быть — тогда все запросы считаются с одного адреса.
function clientIp(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
}

// Ключ лимита: для IPv4 — сам адрес, для IPv6 — сеть /64 (первые четыре группы).
// Абонент IPv6 обычно получает целую сеть /64 и может менять адрес внутри неё
// сколько угодно — лимит по одному адресу он бы просто обходил
export function rateLimitKey(ip: string): string {
  const address = ip.replace(/^\[|\]$/g, "");
  // IPv4 с портом (1.2.3.4:5555 — так пишут некоторые прокси): порт не важен
  const withPort = /^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/.exec(address);
  if (withPort) return withPort[1];
  if (!address.includes(":")) return address;
  const groups = expandIPv6(address);
  if (!groups) return address;
  // IPv4, записанный как IPv6 (::ffff:1.2.3.4 в любой записи), — это обычный IPv4-адрес
  if (groups.slice(0, 5).every((group) => group === "0") && groups[5] === "ffff") {
    const [high, low] = [parseInt(groups[6], 16), parseInt(groups[7], 16)];
    return [high >> 8, high & 255, low >> 8, low & 255].join(".");
  }
  return `${groups.slice(0, 4).join(":")}::/64`;
}

// Полная запись IPv6-адреса: восемь групп без ведущих нулей; null — адрес некорректен
function expandIPv6(address: string): string[] | null {
  const halves = address.split("%")[0].toLowerCase().split("::");
  if (halves.length > 2) return null;
  const parse = (part: string) => {
    if (part === "") return [];
    const groups = part.split(":");
    // IPv4 в конце адреса (::ffff:1.2.3.4) — это две последние группы
    const last = groups.at(-1) ?? "";
    if (last.includes(".")) {
      const parts = last.split(".");
      // Некорректная часть не пройдёт проверку групп ниже
      if (parts.length !== 4 || !parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255)) {
        return ["invalid"];
      }
      const [a, b, c, d] = parts.map(Number);
      groups.splice(-1, 1, ((a << 8) | b).toString(16), ((c << 8) | d).toString(16));
    }
    return groups;
  };
  const head = parse(halves[0]);
  const tail = halves.length === 2 ? parse(halves[1]) : [];
  const missing = 8 - head.length - tail.length;
  // Без «::» групп ровно восемь; «::» заменяет хотя бы одну нулевую группу
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill("0"), ...tail];
  if (!groups.every((group) => /^[0-9a-f]{1,4}$/.test(group))) return null;
  return groups.map((group) => parseInt(group, 16).toString(16));
}

// Учитывает запрос на генерацию путешествия. Считаются все запросы, даже некорректные:
// лимит защищает и от простого засыпания сервера запросами
export const consumeModelRequest = createModelLimit(RATE_LIMIT_PER_IP, RATE_LIMIT_GLOBAL);

// Учитывает оценку свободного ответа моделью (раскрытие по сохранённой оценке не считается)
export const consumeEvaluationRequest = createModelLimit(EVALUATION_LIMIT_PER_IP, EVALUATION_LIMIT_GLOBAL);

// Учитывает вопрос поиска по материалам: эмбеддинг вопроса и ответ модели — один запрос к лимиту
export const consumeSearchRequest = createModelLimit(SEARCH_LIMIT_PER_IP, SEARCH_LIMIT_GLOBAL);

// Учитывает разбор ошибок: эмбеддинги понятий и ответ модели — один запрос к лимиту
export const consumeReviewRequest = createModelLimit(REVIEW_LIMIT_PER_IP, REVIEW_LIMIT_GLOBAL);
