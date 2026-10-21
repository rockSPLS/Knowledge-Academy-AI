import { z } from "zod";
import { checkAnswer } from "@/lib/exercises/server";
import { isSealConfigured, unsealJourney } from "@/lib/journey/seal";
import type { JourneyExercise } from "@/lib/journey/types";
import { readJsonBody } from "@/lib/llm/request";

// POST /api/journey/exercise — работа с упражнением сгенерированного путешествия.
// Браузер присылает зашифрованное путешествие (sealed) и id упражнения; сервер
// расшифровывает путешествие и берёт из него правильные ответы и подсказку.
// - { action: "check", answer, reveal? } — проверка ответа, как POST /api/check:
//   разбор с правильными ответами — только при верном ответе или reveal = true;
// - { action: "hint" } — подсказка к упражнению;
// - { action: "skip" } — время вышло, а ответа нет: только общее объяснение.
// Модель здесь не вызывается, поэтому лимита частоты нет (как и у /api/check).

// Зашифрованное путешествие обычно 15–35 КБ, но бывает до ~270 КБ — лимит с запасом.
// Обычный лимит запросов к модели (MAX_REQUEST_BYTES) рассчитан на текст пользователя и меньше
const MAX_BODY_BYTES = 400_000;

const base = {
  sealed: z.string().min(1),
  exerciseId: z.string().min(1).max(100),
};

const requestSchema = z.discriminatedUnion("action", [
  z.object({ ...base, action: z.literal("check"), answer: z.unknown(), reveal: z.boolean().optional() }),
  z.object({ ...base, action: z.literal("hint") }),
  z.object({ ...base, action: z.literal("skip") }),
]);

export async function POST(request: Request) {
  const body = await readJsonBody(request, MAX_BODY_BYTES);
  if (!body.ok) return body.response;

  const parsed = requestSchema.safeParse(body.data);
  if (!parsed.success) {
    return Response.json({ code: "bad-request", error: "Некорректный запрос" }, { status: 400 });
  }

  if (!isSealConfigured()) {
    console.error("[journey] не задан JOURNEY_SECRET (не короче 32 символов)");
    return Response.json(
      { code: "not-configured", error: "Проверка ответов сейчас недоступна" },
      { status: 503 },
    );
  }

  const journey = unsealJourney(parsed.data.sealed);
  if (!journey) {
    // Подделано, повреждено или зашифровано другим секретом (секрет сменили)
    return Response.json(
      { code: "bad-journey", error: "Путешествие повреждено или устарело. Составьте новое." },
      { status: 400 },
    );
  }

  const found = findExercise(journey.checkpoints, parsed.data.exerciseId);
  if (!found) {
    return Response.json({ code: "not-found", error: "Упражнение не найдено" }, { status: 404 });
  }

  switch (parsed.data.action) {
    case "hint":
      return Response.json({ hint: found.hint });
    case "skip":
      return Response.json({ explanation: found.exercise.explanation });
    case "check": {
      const result = checkAnswer(found.exercise, parsed.data.answer, parsed.data.reveal ?? false);
      if (!result) {
        return Response.json(
          { code: "bad-request", error: "Ответ не подходит для этого упражнения" },
          { status: 400 },
        );
      }
      return Response.json(result);
    }
  }
}

function findExercise(
  checkpoints: { exercises: JourneyExercise[] }[],
  exerciseId: string,
): JourneyExercise | undefined {
  for (const checkpoint of checkpoints) {
    const found = checkpoint.exercises.find((item) => item.exercise.id === exerciseId);
    if (found) return found;
  }
  return undefined;
}
