import "server-only";
import {
  RATE_LIMIT_GLOBAL,
  RATE_LIMIT_GLOBAL_WINDOW_MS,
  RATE_LIMIT_PER_IP,
  RATE_LIMIT_PER_IP_WINDOW_MS,
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

const perIp = createRateLimiter(RATE_LIMIT_PER_IP, RATE_LIMIT_PER_IP_WINDOW_MS);
const allClients = createRateLimiter(RATE_LIMIT_GLOBAL, RATE_LIMIT_GLOBAL_WINDOW_MS);

// IP посетителя. На Vercel заголовок x-forwarded-for выставляет платформа
// (значение от клиента перезаписывается). На других хостингах его можно подделать,
// а локально его может не быть — тогда все запросы считаются с одного адреса.
function clientIp(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
}

// Учитывает запрос к модели. Считаются все запросы, даже некорректные:
// лимит защищает и от простого засыпания сервера запросами
export function consumeModelRequest(request: Request): RateLimitResult {
  const byIp = perIp(clientIp(request));
  if (!byIp.ok) return byIp;
  return allClients("all");
}
