import { z } from "zod";
import { askModel, generateJourney } from "@/lib/journey/generate";
import { findPortalMaterial, isPortalSearchConfigured, type PortalMaterial } from "@/lib/journey/portal";
import { toPublicJourney } from "@/lib/journey/public";
import { isSealConfigured, sealJourney } from "@/lib/journey/seal";
import { MAX_PORTAL_TOPIC_LENGTH, MAX_REQUEST_BYTES, MAX_SOURCE_LENGTH } from "@/lib/llm/limits";
import { consumeModelRequest } from "@/lib/llm/rateLimit";
import { readJsonBody } from "@/lib/llm/request";
import { modelFailureResponse, portalFailureResponse, rateLimitedResponse } from "@/lib/llm/responses";
import { parseSearchContext } from "@/lib/search/request";

// POST /api/journey — генерация путешествия.
// Принимает { source } — своя тема или текст — или { topic, progress? } — тема из материалов
// портала и сводка прогресса (та же, что у поиска; разбирается по одной записи).
// Возвращает { journey, sealed }: journey — публичная часть (без правильных ответов
// и подсказок), sealed — зашифрованное путешествие целиком; браузер присылает его обратно
// при проверке ответов. По материалам портала: ничего не нашлось — 422 not-in-materials,
// модель не вызывается; без модели эмбеддингов или если сервис не ответил — 503 portal-unavailable.

// Генерация — несколько запросов к модели подряд и с повтором; потолок времени функции
export const maxDuration = 300;

const requestSchema = z.union([
  z.object({ source: z.string().trim().min(1).max(MAX_SOURCE_LENGTH) }),
  z.object({ topic: z.string().trim().min(1).max(MAX_PORTAL_TOPIC_LENGTH) }),
]);

export async function POST(request: Request) {
  const body = await readJsonBody(request, MAX_REQUEST_BYTES);
  if (!body.ok) return body.response;

  const parsed = requestSchema.safeParse(body.data);
  if (!parsed.success) {
    return Response.json(
      {
        code: "bad-request",
        error: `Нужна тема или текст не длиннее ${MAX_SOURCE_LENGTH} символов (тема из материалов портала — до ${MAX_PORTAL_TOPIC_LENGTH})`,
      },
      { status: 400 },
    );
  }
  const portal = "topic" in parsed.data;

  // Без модели эмбеддингов искать нечем — запроса нет вовсе, лимит не тратится
  if (portal && !isPortalSearchConfigured()) return portalFailureResponse("unavailable");

  const limit = consumeModelRequest(request);
  if (!limit.ok) return rateLimitedResponse(limit.retryAfterSec);

  // Без секрета путешествие не зашифровать — проверяем до запросов к модели
  if (!isSealConfigured()) {
    console.error("[journey] не задан JOURNEY_SECRET (не короче 32 символов)");
    return modelFailureResponse("not-configured");
  }

  let source: string | PortalMaterial;
  if ("topic" in parsed.data) {
    // Сводка — данные из браузера: негодные записи пропускаются, а не ломают запрос
    const { progress } = parseSearchContext({ progress: (body.data as { progress?: unknown }).progress }, "journey");
    const found = await findPortalMaterial(parsed.data.topic, progress, request.signal);
    if (!found.ok) {
      if (found.reason === "not-in-materials") console.log("[journey] по теме в материалах портала ничего не нашлось — модель не вызывается");
      return portalFailureResponse(found.reason);
    }
    source = found.material;
  } else {
    source = parsed.data.source;
  }

  // request.signal срабатывает, если посетитель закрыл страницу: запросы к модели отменяются
  const result = await generateJourney(source, askModel, request.signal);
  if (!result.ok) {
    if (result.reason === "unsuitable") {
      return Response.json({ code: "unsuitable", error: result.message }, { status: 422 });
    }
    return modelFailureResponse(result.reason);
  }

  const sealed = sealJourney(result.journey);
  if (!sealed) return modelFailureResponse("not-configured");
  return Response.json({ journey: toPublicJourney(result.journey), sealed });
}
