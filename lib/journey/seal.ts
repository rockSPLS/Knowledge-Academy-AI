import "server-only";
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import type { Journey } from "./types";

// Зашифрованное путешествие. Базы нет: сервер шифрует путешествие целиком
// (с правильными ответами и подсказками) и отдаёт браузеру строку; при проверке
// ответа браузер присылает её обратно. Прочитать ответы без ключа нельзя,
// а подмена любого байта обнаруживается: AES-256-GCM — шифрование с проверкой подлинности.
// Приём описан в руководстве Next.js по аутентификации («Stateless Sessions»);
// в отличие от него строка идёт в теле запроса, а не в cookie — в cookie
// помещается около 4 КБ, а путешествие больше.
//
// Ключ — переменная окружения JOURNEY_SECRET (образец — .env.example), не короче
// 32 символов. Без неё генерация недоступна. Смена секрета делает недействительными
// уже выданные путешествия — их нужно сгенерировать заново.

const FORMAT = "v1";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const MIN_SECRET_LENGTH = 32;

// Ключ шифрования выводится из секрета (HKDF), а не берётся напрямую:
// секрет — произвольная строка, а AES-256 нужен ключ ровно в 32 байта
function readKey(): Buffer | null {
  const secret = process.env.JOURNEY_SECRET?.trim();
  if (!secret || secret.length < MIN_SECRET_LENGTH) return null;
  return Buffer.from(hkdfSync("sha256", secret, "", "journey-seal", 32));
}

export function isSealConfigured(): boolean {
  return readKey() !== null;
}

// Возвращает строку вида "v1.<base64url>" или null, если секрет не задан
export function sealJourney(journey: Journey): string | null {
  const key = readKey();
  if (!key) return null;
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  // Версия формата участвует в проверке подлинности: её нельзя подменить
  cipher.setAAD(Buffer.from(FORMAT));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(journey), "utf8"), cipher.final()]);
  const payload = Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
  return `${FORMAT}.${payload.toString("base64url")}`;
}

// Расшифровывает путешествие; null — секрет не задан, строка повреждена, подделана
// или зашифрована другим секретом
export function unsealJourney(sealed: string): Journey | null {
  const key = readKey();
  if (!key) return null;
  const [format, data, extra] = sealed.split(".");
  if (format !== FORMAT || !data || extra !== undefined) return null;
  const payload = Buffer.from(data, "base64url");
  if (payload.length <= IV_BYTES + TAG_BYTES) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, payload.subarray(0, IV_BYTES));
    decipher.setAAD(Buffer.from(FORMAT));
    decipher.setAuthTag(payload.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
    const decrypted = Buffer.concat([
      decipher.update(payload.subarray(IV_BYTES + TAG_BYTES)),
      decipher.final(),
    ]);
    const journey = JSON.parse(decrypted.toString("utf8")) as Journey;
    return journey.version === 1 ? journey : null;
  } catch {
    return null;
  }
}
