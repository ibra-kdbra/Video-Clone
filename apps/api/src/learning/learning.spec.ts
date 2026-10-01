import { describe, expect, it } from 'vitest';
import type { StoredQuestion } from '../database/schema.js';
import { gradeQuiz, normalizeAnswer, storeQuestions } from './quiz-grading.js';
import { countSegments, hasSegment, markSegments, segmentCount } from './segments.js';

describe('watch segments', () => {
  it('counts 5-second stretches, rounding up', () => {
    expect(segmentCount(0)).toBe(1);
    expect(segmentCount(5)).toBe(1);
    expect(segmentCount(5.1)).toBe(2);
    expect(segmentCount(24)).toBe(5);
  });

  it('sets stretches once, ignores ones past the end, and merges with what was there', () => {
    let bits = markSegments(Buffer.alloc(0), [0, 3, 3, 9, 10, 99, -1, 1.5], 11);
    expect(bits.length).toBe(2);
    expect([0, 3, 9, 10].every((segment) => hasSegment(bits, segment))).toBe(true);
    expect(countSegments(bits, 11)).toBe(4);
    bits = markSegments(bits, [1, 3], 11);
    expect(countSegments(bits, 11)).toBe(5);
  });

  it('drops stretches beyond a video that got shorter', () => {
    const long = markSegments(Buffer.alloc(0), [0, 5, 7], 8);
    const short = markSegments(long, [], 6);
    expect(countSegments(short, 6)).toBe(2);
    expect(hasSegment(short, 7)).toBe(false);
  });
});

describe('quiz grading', () => {
  const questions: StoredQuestion[] = storeQuestions([
    { kind: 'single', prompt: 'Which?', explanation: '', points: 2, options: [{ label: 'A', correct: true }, { label: 'B', correct: false }], answers: [] },
    { kind: 'multiple', prompt: 'Which ones?', explanation: '', points: 1, options: [{ label: 'C', correct: true }, { label: 'D', correct: true }, { label: 'E', correct: false }], answers: [] },
    { kind: 'short', prompt: 'Name it', explanation: '', points: 1, options: [], answers: ['Ré majeur'] },
  ]);
  const [single, multiple, short] = questions as [StoredQuestion, StoredQuestion, StoredQuestion];
  const option = (question: StoredQuestion, label: string) => question.options.find((choice) => choice.label === label)!.id;

  it('gives every question and choice its own id', () => {
    const ids = questions.flatMap((question) => [question.id, ...question.options.map((choice) => choice.id)]);
    expect(new Set(ids).size).toBe(ids.length);
    const again = storeQuestions([{ id: single.id, kind: 'short', prompt: 'P', explanation: '', points: 1, options: [], answers: ['x'] }, { id: single.id, kind: 'short', prompt: 'Q', explanation: '', points: 1, options: [], answers: ['y'] }]);
    expect(again[0]!.id).toBe(single.id);
    expect(again[1]!.id).not.toBe(single.id);
  });

  it('marks right answers right', () => {
    const grade = gradeQuiz(questions, {
      [single.id]: [option(single, 'A')],
      [multiple.id]: [option(multiple, 'D'), option(multiple, 'C')],
      [short.id]: '  re   MAJEUR. ',
    });
    expect(grade).toMatchObject({ score: 4, maxScore: 4, percent: 100 });
  });

  it('gives no partial credit, and counts wrong shapes and missing answers as wrong', () => {
    const grade = gradeQuiz(questions, {
      [single.id]: [option(single, 'A'), option(single, 'B')],
      [multiple.id]: [option(multiple, 'C')],
      [short.id]: [option(single, 'A')],
      'not-a-question': 'x',
    });
    expect(grade.results.map((result) => result.correct)).toEqual([false, false, false]);
    expect(grade).toMatchObject({ score: 0, maxScore: 4, percent: 0 });
    expect(gradeQuiz(questions, {}).score).toBe(0);
  });

  it('normalizes short answers', () => {
    expect(normalizeAnswer(' Café  au   LAIT!! ')).toBe('cafe au lait');
    expect(normalizeAnswer('naïve')).toBe('naive');
  });
});
