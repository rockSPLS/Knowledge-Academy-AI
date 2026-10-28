import "server-only";
import { getExercise } from "@/lib/exercises/bank";
import type { Exercise, Verdict } from "@/lib/exercises/types";
import { topicStatus, type TopicStatus } from "@/lib/progress/mastery";
import { getAllTopics, getTopicOfExercise } from "@/lib/progress/topics";
import { CHOICE_TYPES } from "@/lib/progress/types";
import { answerMarks, quote } from "./answers";
import type { ProgressInput } from "./request";

// Прогресс в поиске. Браузер присылает вместе с вопросом короткую сводку
// (components/progress/summary.ts): последний итог по каждому упражнению, несколько
// последних ошибок (с ответом) и понятия путешествий — которые стоит повторить и которые
// усвоены. Сервер:
// - ставит упражнению в источниках ярлык по последнему ответу и открывает объяснение,
//   если человек на это упражнение уже отвечал;
// - считает по тому же правилу (lib/progress/mastery.ts), какие темы статей усвоены;
// - собирает для модели блок «Прогресс» — по найденным темам, плюс темы, которые стоит
//   повторить, понятия путешествий и последние ошибки (с ответом человека словами вариантов).
//
// Сервер верит сводке на слово: прогресс лежит в браузере, и проверить, отвечал ли
// человек на самом деле, нельзя. Объяснение упражнения не секрет — его прячут,
// чтобы не подсказывать до попытки; подделав сводку, человек подсказывает только себе.

type Summary = ProgressInput;

// Последний итог по упражнению банка; упражнения не из банка отбрасываются
export function latestResults(summary: Summary | undefined): Map<string, Verdict> {
  const results = new Map<string, Verdict>();
  for (const item of summary?.exercises ?? []) {
    if (getExercise(item.id)) results.set(item.id, item.verdict);
  }
  return results;
}

export function hasProgress(summary: Summary | undefined): boolean {
  return Boolean(
    summary &&
      (summary.exercises.length > 0 || summary.journeyConcepts.length > 0 || summary.masteredConcepts.length > 0),
  );
}

// Ярлык упражнения в источниках: «Вы ответили верно» или «Стоит повторить» —
// по тому же правилу, что и тема, только из одного упражнения
export function resultLabel(verdict: Verdict | undefined): "correct" | "review" | undefined {
  if (!verdict) return undefined;
  return topicStatus([verdict]) === "mastered" ? "correct" : "review";
}

function statusOfTopic(exerciseIds: string[], results: Map<string, Verdict>): TopicStatus {
  return topicStatus(exerciseIds.map((id) => results.get(id) ?? null));
}

const STATUS_TEXT: Record<TopicStatus, string> = {
  mastered: "усвоено — последний ответ на каждое упражнение темы верный",
  review: "стоит повторить — последний ответ на упражнение неверный или частично верный",
  "not-started": "на упражнения этой темы человек ещё не отвечал",
};

const VERDICT_TEXT: Record<Verdict, string> = {
  correct: "верно",
  partial: "частично верно",
  incorrect: "неверно",
};

// Блок «Прогресс» для промпта ответа. fragmentTopics — тема статьи каждого найденного
// фрагмента по порядку номеров (<slug>#<якорь>; null — фрагмент путешествия). По ним у строки
// ошибки сервер сам ставит номера фрагментов её раздела: модель к сведениям о прогрессе
// ставила номера подряд, и ссылка вела на раздел о другом. Пустой прогресс — так и сказано, но только то, что известно серверу:
// в сводку попадают только понятия с итогом «усвоено» или «стоит повторить» (до 10 каждого
// вида): начатое путешествие без ошибок там не видно, и «не проходил путешествий» было бы неправдой
export function progressBlock(summary: Summary | undefined, fragmentTopics: (string | null)[]): string {
  const foundTopics = fragmentTopics.filter((topic): topic is string => topic !== null);
  const numbersOf = (key: string) =>
    fragmentTopics.flatMap((topic, i) => (topic === key ? [`[${i + 1}]`] : [])).join("");
  if (!hasProgress(summary)) {
    return "Сведений о прогрессе нет: ответов на упражнения статей и теста нет, усвоенных понятий из путешествий и понятий, которые стоит повторить, тоже нет.";
  }
  const results = latestResults(summary);
  const topics = getAllTopics();
  const lines: string[] = [];

  const found = topics.filter((topic) => foundTopics.includes(topic.key));
  if (found.length > 0) {
    lines.push("Темы найденных фрагментов:");
    for (const topic of found) lines.push(`- ${topic.path.join(" › ")}: ${STATUS_TEXT[statusOfTopic(topic.exerciseIds, results)]}`);
  }

  const byStatus = (status: TopicStatus) =>
    topics.filter((topic) => statusOfTopic(topic.exerciseIds, results) === status).map((topic) => topic.path.join(" › "));
  const mastered = byStatus("mastered");
  const review = byStatus("review");
  lines.push(`Темы статей, которые человек усвоил: ${mastered.length > 0 ? mastered.join("; ") : "пока нет"}.`);
  lines.push(`Темы статей, которые стоит повторить: ${review.length > 0 ? review.join("; ") : "нет"}.`);

  const describe = (items: Summary["journeyConcepts"]) =>
    items.length > 0 ? items.map((item) => `«${item.concept}» (путешествие «${item.journey}»)`).join("; ") : "нет";
  lines.push(`Понятия из путешествий, которые человек усвоил: ${describe(summary!.masteredConcepts)}.`);
  lines.push(`Понятия из путешествий, которые стоит повторить: ${describe(summary!.journeyConcepts)}.`);

  // Ошибки в путешествиях — пунктами того же списка, что ошибки статей: на «где я ошибался?»
  // модель пересказывала список и пропускала понятия, названные отдельной строкой
  const mistakes = summary!.mistakes.filter((item) => getExercise(item.id));
  if (mistakes.length > 0 || summary!.journeyConcepts.length > 0) {
    lines.push("Последние ошибки:");
    for (const item of summary!.journeyConcepts) {
      lines.push(`- Путешествие «${item.journey}», понятие «${item.concept}»: были ошибки в упражнениях.`);
    }
    for (const mistake of mistakes) {
      const exercise = getExercise(mistake.id)!;
      const topic = getTopicOfExercise(mistake.id);
      const answer = describeAnswer(exercise, mistake.answer);
      const marks = answer ? answerMarks(exercise, mistake.answer) : null;
      const latest = results.get(mistake.id);
      const numbers = topic ? numbersOf(topic.key) : "";
      lines.push(
        `- Упражнение «${exercise.question}»${topic ? ` (${topic.path.join(" › ")})` : ""}: ${VERDICT_TEXT[mistake.verdict]}.` +
          (answer ? ` Ответ человека: ${answer}.` : "") +
          (marks?.errors ? ` Что в ответе неверно: ${marks.errors}.` : "") +
          (marks?.correct ? ` Верно, не ошибка: ${marks.correct}.` : "") +
          (latest === "correct" ? " Позже человек ответил на него верно — сейчас это уже не ошибка." : "") +
          ` Объяснение верного ответа: ${exercise.explanation}` +
          (numbers
            ? ` Фрагменты этой ошибки: ${numbers}.`
            : " Раздела этой ошибки среди найденных фрагментов нет — без номера."),
      );
    }
  }
  return lines.join("\n");
}

// Ответ человека словами вариантов — для модели. null — ответа нет (упражнение не с выбором)
// или он не подходит к упражнению
export function describeAnswer(exercise: Exercise, answer: unknown): string | null {
  if (answer === undefined || !(CHOICE_TYPES as readonly string[]).includes(exercise.type)) return null;
  const record = answer as Record<string, unknown>;
  switch (exercise.type) {
    case "multiple-choice": {
      const selected = stringList(record.selected);
      const texts = selected.map((id) => exercise.options.find((option) => option.id === id)?.text).filter(Boolean);
      return texts.length > 0 ? `выбрал(а) ${texts.map((text) => quote(text ?? "")).join(", ")}` : null;
    }
    case "true-false": {
      const answers = isPlainRecord(record.answers) ? record.answers : {};
      const parts = exercise.statements
        .filter((statement) => typeof answers[statement.id] === "boolean")
        .map((statement) => `${quote(statement.text)} — ${answers[statement.id] ? "верно" : "неверно"}`);
      return parts.length > 0 ? `оценил(а) утверждения так: ${parts.join("; ")}` : null;
    }
    case "match-pairs": {
      const matches = isPlainRecord(record.matches) ? record.matches : {};
      const parts = exercise.terms
        .map((term) => {
          const definition = exercise.definitions.find((item) => item.id === matches[term.id]);
          return definition ? `${quote(term.text)} → ${quote(definition.text)}` : null;
        })
        .filter(Boolean);
      return parts.length > 0 ? `соединил(а) пары: ${parts.join("; ")}` : null;
    }
    case "order-steps": {
      const texts = stringList(record.order)
        .map((id) => exercise.steps.find((step) => step.id === id)?.text)
        .filter(Boolean);
      return texts.length > 0 ? `расставил(а) шаги так: ${texts.map((text, i) => `${i + 1}) ${text}`).join(" ")}` : null;
    }
    case "costed-select": {
      const versions = exercise.items.flatMap((item) => item.versions);
      const texts = stringList(record.selected)
        .map((id) => versions.find((version) => version.id === id)?.text)
        .filter(Boolean);
      return texts.length > 0 ? `взял(а) в промпт: ${texts.map((text) => quote(text ?? "")).join(", ")}` : "ничего не взял(а)";
    }
    default:
      return null;
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").slice(0, 20) : [];
}

