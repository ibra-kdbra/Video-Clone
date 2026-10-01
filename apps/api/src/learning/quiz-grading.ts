import { randomUUID } from 'node:crypto';
import type { QuestionInput, QuizQuestion, QuizQuestionDraft } from '@grand/contracts';
import type { StoredQuestion, StoredResult } from '../database/schema.js';

/**
 * Short answers are compared without regard to case, accents, spacing or a final full stop, so
 * "Ré   majeur." matches "re majeur".
 */
export function normalizeAnswer(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.!?]+$/, '')
    .trim();
}

/**
 * The questions as stored, with ids for every question and choice. Ids the editor sent back are
 * kept (so a question's statistics survive edits); missing or repeated ones get new ids.
 */
export function storeQuestions(input: QuestionInput[]): StoredQuestion[] {
  const used = new Set<string>();
  const idFor = (proposed: string | undefined) => {
    const id = proposed && !used.has(proposed) ? proposed : randomUUID();
    used.add(id);
    return id;
  };
  return input.map((question) => ({
    id: idFor(question.id),
    kind: question.kind,
    prompt: question.prompt,
    explanation: question.explanation,
    points: question.points,
    options: question.kind === 'short' ? [] : question.options.map((option) => ({ id: idFor(option.id), label: option.label, correct: option.correct })),
    answers: question.kind === 'short' ? question.answers : [],
  }));
}

export interface Grade {
  results: StoredResult[];
  score: number;
  maxScore: number;
  percent: number;
}

/**
 * Marks an attempt. A choice question is right only with exactly the right choices (no partial
 * credit for "multiple"); a short answer is right when it matches an accepted one. Answers of the
 * wrong shape, and unknown question ids, count as wrong or are ignored.
 */
export function gradeQuiz(questions: StoredQuestion[], answers: Record<string, string | string[]>): Grade {
  const results = questions.map((question): StoredResult => {
    const answer = answers[question.id];
    let correct = false;
    if (question.kind === 'short') {
      correct = typeof answer === 'string' && question.answers.some((accepted) => normalizeAnswer(accepted) === normalizeAnswer(answer));
    } else if (Array.isArray(answer)) {
      const chosen = new Set(answer);
      const right = question.options.filter((option) => option.correct).map((option) => option.id);
      correct = chosen.size === right.length && right.every((id) => chosen.has(id)) && (question.kind === 'multiple' || chosen.size === 1);
    }
    return { questionId: question.id, correct, points: correct ? question.points : 0, maxPoints: question.points };
  });
  const score = results.reduce((sum, result) => sum + result.points, 0);
  const maxScore = results.reduce((sum, result) => sum + result.maxPoints, 0);
  return { results, score, maxScore, percent: maxScore ? Math.round((score / maxScore) * 100) : 0 };
}

/** What someone taking the quiz may see of a question. */
export const forTaker = (question: StoredQuestion): QuizQuestion => ({
  id: question.id,
  kind: question.kind,
  prompt: question.prompt,
  points: question.points,
  options: question.options.map(({ id, label }) => ({ id, label })),
});

export const forEditor = (question: StoredQuestion): QuizQuestionDraft => ({
  id: question.id,
  kind: question.kind,
  prompt: question.prompt,
  explanation: question.explanation,
  points: question.points,
  options: question.options,
  answers: question.answers,
});
