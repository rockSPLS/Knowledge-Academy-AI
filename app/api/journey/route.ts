import { z } from "zod";
import { askModel, generateJourney } from "@/lib/journey/generate";
import { toPublicJourney } from "@/lib/journey/public";
import { isSealConfigured, sealJourney } from "@/lib/journey/seal";
import { MAX_REQUEST_BYTES, MAX_SOURCE_LENGTH } from "@/lib/llm/limits";
import { consumeModelRequest } from "@/lib/llm/rateLimit";
import { readJsonBody } from "@/lib/llm/request";
import { modelFailureResponse, rateLimitedResponse } from "@/lib/llm/responses";

// POST /api/journey — генерация путешествия по теме или тексту.
// Принимает { source }, возвращает { journey, sealed }:
// journey — публичная часть (без правильных ответов и подсказок),
// sealed — зашифрованное путешествие целиком; браузер присылает его обратно при проверке ответов.

// Генерация — несколько запросов к модели подряд и с повтором; потолок времени функции
export const maxDuration = 300;

const requestSchema = z.object({
  source: z.string().trim().min(1).max(MAX_SOURCE_LENGTH),
});

export async function POST(request: Request) {
  const limit = consumeModelRequest(request);
  if (!limit.ok) return rateLimitedResponse(limit.retryAfterSec);

  const body = await readJsonBody(request, MAX_REQUEST_BYTES);
  if (!body.ok) return body.response;

  const parsed = requestSchema.safeParse(body.data);
  if (!parsed.success) {
    return Response.json(
      {
        code: "bad-request",
        error: `Нужна тема или текст не длиннее ${MAX_SOURCE_LENGTH} символов`,
      },
      { status: 400 },
    );
  }

  // Без секрета путешествие не зашифровать — проверяем до запросов к модели
  if (!isSealConfigured()) {
    console.error("[journey] не задан JOURNEY_SECRET (не короче 32 символов)");
    return modelFailureResponse("not-configured");
  }

  // request.signal срабатывает, если посетитель закрыл страницу: запросы к модели отменяются
  const result = await generateJourney(parsed.data.source, askModel, request.signal);
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
