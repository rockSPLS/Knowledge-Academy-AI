import { z } from "zod";
import { MAX_QUESTION_LENGTH, MAX_SEARCH_REQUEST_BYTES } from "@/lib/llm/limits";
import { consumeSearchRequest } from "@/lib/llm/rateLimit";
import { readJsonBody } from "@/lib/llm/request";
import { rateLimitedResponse } from "@/lib/llm/responses";
import { searchAndAnswer } from "@/lib/search/search";
import type { SearchResponse } from "@/lib/search/types";

// POST /api/search — поиск по материалам портала с ответом ИИ.
// Принимает { question }, возвращает SearchResponse (lib/search/types.ts):
// найденные фрагменты как источники, ответ модели или null и режим поиска
// (по смыслу и словам / только по словам). Без модели ответ 200 с answer = null:
// найденные фрагменты всё равно показываются.

// Эмбеддинг вопроса (до 10 с) и ответ модели (до 25 с с повторами библиотеки)
export const maxDuration = 60;

const requestSchema = z.object({
  question: z.string().trim().min(1).max(MAX_QUESTION_LENGTH),
});

export async function POST(request: Request) {
  const limit = consumeSearchRequest(request);
  if (!limit.ok) return rateLimitedResponse(limit.retryAfterSec);

  const body = await readJsonBody(request, MAX_SEARCH_REQUEST_BYTES);
  if (!body.ok) return body.response;

  const parsed = requestSchema.safeParse(body.data);
  if (!parsed.success) {
    return Response.json(
      { code: "bad-request", error: `Нужен вопрос не длиннее ${MAX_QUESTION_LENGTH} символов` },
      { status: 400 },
    );
  }

  // request.signal срабатывает, если посетитель закрыл страницу: запросы к модели отменяются
  const result: SearchResponse = await searchAndAnswer(parsed.data.question, undefined, request.signal);
  return Response.json(result);
}
