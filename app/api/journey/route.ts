import { z } from "zod";
import { askModel, generateJourney } from "@/lib/journey/generate";
import {
  articlePortalMaterial,
  findPortalMaterial,
  isPortalArticle,
  isPortalSearchConfigured,
  type PortalMaterial,
} from "@/lib/journey/portal";
import { toPublicJourney } from "@/lib/journey/public";
import { isSealConfigured, sealJourney } from "@/lib/journey/seal";
import { MAX_PORTAL_TOPIC_LENGTH, MAX_REQUEST_BYTES, MAX_SOURCE_LENGTH } from "@/lib/llm/limits";
import { consumeModelRequest } from "@/lib/llm/rateLimit";
import { readJsonBody } from "@/lib/llm/request";
import { modelFailureResponse, portalFailureResponse, rateLimitedResponse } from "@/lib/llm/responses";
import { parseSearchContext } from "@/lib/search/request";

// POST /api/journey — генерация путешествия.
// Принимает { source } — своя тема или текст — или { topic, progress? } — тема из материалов
// портала и сводка прогресса (та же, что у поиска; разбирается по одной записи) — или
// { topic, article, progress? } — «Путешествие по этой статье»: материал — разделы статьи
// article, без поиска и без модели эмбеддингов; статьи такой нет — 400.
// Возвращает { journey, sealed }: journey — публичная часть (без правильных ответов
// и подсказок), sealed — зашифрованное путешествие целиком; браузер присылает его обратно
// при проверке ответов. По материалам портала: ничего не нашлось — 422 not-in-materials,
// модель не вызывается; без модели эмбеддингов или если сервис не ответил — 503 portal-unavailable.

// Генерация — несколько запросов к модели подряд и с повтором; потолок времени функции
export const maxDuration = 300;

const requestSchema = z.union([
  z.object({ source: z.string().trim().min(1).max(MAX_SOURCE_LENGTH) }),
  z.object({
    topic: z.string().trim().min(1).max(MAX_PORTAL_TOPIC_LENGTH),
    article: z.string().max(100).optional(),
  }),
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
  const article = "topic" in parsed.data ? parsed.data.article : undefined;
  const search = "topic" in parsed.data && article === undefined;

  // Статьи нет — запроса нет, лимит не тратится
  if (article !== undefined && !isPortalArticle(article)) {
    return Response.json({ code: "bad-request", error: "Такой статьи нет" }, { status: 400 });
  }

  // Без модели эмбеддингов искать нечем — запроса нет вовсе, лимит не тратится.
  // Путешествию по одной статье поиск не нужен
  if (search && !isPortalSearchConfigured()) return portalFailureResponse("unavailable");

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
    const material = article !== undefined ? articlePortalMaterial(article, parsed.data.topic, progress) : null;
    if (material) {
      source = material;
    } else {
      const found = await findPortalMaterial(parsed.data.topic, progress, request.signal);
      if (!found.ok) {
        if (found.reason === "not-in-materials") console.log("[journey] по теме в материалах портала ничего не нашлось — модель не вызывается");
        return portalFailureResponse(found.reason);
      }
      source = found.material;
    }
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
