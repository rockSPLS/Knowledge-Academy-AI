import { z } from "zod";
import { getExercise } from "@/lib/exercises/bank";
import { checkAnswer } from "@/lib/exercises/server";

// POST /api/check — проверяет ответ на упражнение.
// Принимает { exerciseId, answer, reveal? }, возвращает { score, verdict, hint?, review? }.
// Разбор с правильными ответами (review) отдаётся только по правилу из lib/exercises/server.ts:
// при верном ответе или при явном запросе раскрытия.

const requestSchema = z.object({
  exerciseId: z.string().min(1).max(100),
  answer: z.unknown(),
  // true — раскрыть правильный ответ (кнопка «Показать ответ» или режим теста)
  reveal: z.boolean().optional(),
});

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Тело запроса должно быть JSON" }, { status: 400 });
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Некорректный запрос" }, { status: 400 });
  }

  const exercise = getExercise(parsed.data.exerciseId);
  if (!exercise) {
    return Response.json({ error: "Упражнение не найдено" }, { status: 404 });
  }

  const result = checkAnswer(exercise, parsed.data.answer, parsed.data.reveal ?? false);
  if (!result) {
    return Response.json({ error: "Ответ не подходит для этого упражнения" }, { status: 400 });
  }

  return Response.json(result);
}
