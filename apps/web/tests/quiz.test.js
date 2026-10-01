import { describe, expect, it } from 'vitest';

import {
  addChoice,
  attemptInput,
  attemptsLeftLabel,
  checkQuiz,
  chooseOption,
  fromDraft,
  hasQuizErrors,
  isAnswered,
  markCorrect,
  moveQuestion,
  newQuestion,
  quizChanged,
  quizErrors,
  removeChoice,
  revealsAnswers,
  scoreLine,
  switchChoiceKind,
  toQuizInput,
  unanswered,
  writeAnswer,
} from '../src/lib/quiz.js';

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const single = { id: id(1), kind: 'single', prompt: 'Which key is C?', points: 1, options: [{ id: id(11) }, { id: id(12) }, { id: id(13) }] };
const multiple = { id: id(2), kind: 'multiple', prompt: 'Which are white keys?', points: 2, options: [{ id: id(21) }, { id: id(22) }, { id: id(23) }] };
const short = { id: id(3), kind: 'short', prompt: 'Name the scale', points: 1, options: [] };
const questions = [single, multiple, short];

describe('taking a quiz', () => {
  it('keeps one choice for single choice, and any number for multiple choice, in the quiz’s order', () => {
    let answers = {};
    answers = chooseOption(answers, single, id(11));
    answers = chooseOption(answers, single, id(13));
    expect(answers[single.id]).toEqual([id(13)]);

    answers = chooseOption(answers, multiple, id(23));
    answers = chooseOption(answers, multiple, id(21));
    answers = chooseOption(answers, multiple, id(21));
    expect(answers[multiple.id]).toEqual([id(21), id(23)]);
    answers = chooseOption(answers, multiple, id(23), false);
    expect(answers[multiple.id]).toEqual([id(21)]);
  });

  it('knows which questions still need an answer', () => {
    let answers = writeAnswer({}, short.id, '   ');
    expect(isAnswered(short, answers[short.id])).toBe(false);
    expect(unanswered(questions, answers).map((q) => q.id)).toEqual([single.id, multiple.id, short.id]);
    answers = chooseOption(writeAnswer(answers, short.id, 'C major'), single, id(12));
    expect(unanswered(questions, answers).map((q) => q.id)).toEqual([multiple.id]);
  });

  it('sends every question, unanswered ones empty, and only choices that exist', () => {
    const answers = { [single.id]: [id(12), 'not-a-choice'], [short.id]: '  C major  ' };
    expect(attemptInput(questions, answers)).toEqual({ answers: { [single.id]: [id(12)], [multiple.id]: [], [short.id]: 'C major' } });
  });

  it('describes scores, attempts left and whether answers are shown', () => {
    expect(scoreLine({ score: 7, maxScore: 10, percent: 70 })).toBe('7 of 10 points · 70%');
    expect(scoreLine({ score: 1, maxScore: 1, percent: 100 })).toBe('1 of 1 point · 100%');
    expect(attemptsLeftLabel(null)).toBe('Unlimited attempts');
    expect(attemptsLeftLabel(0)).toBe('No attempts left');
    expect(attemptsLeftLabel(1)).toBe('1 attempt left');
    expect(attemptsLeftLabel(3)).toBe('3 attempts left');
    const hidden = { questions: [{ correctOptionIds: null, acceptedAnswers: null, explanation: null }] };
    expect(revealsAnswers(hidden)).toBe(false);
    expect(revealsAnswers({ questions: [{ correctOptionIds: [id(11)], acceptedAnswers: null, explanation: null }] })).toBe(true);
  });
});

describe('building a quiz', () => {
  const draft = {
    lessonId: id(99),
    passPercent: 70,
    maxAttempts: 3,
    attemptCount: 2,
    questions: [
      { id: id(1), kind: 'single', prompt: 'Which key is C?', explanation: 'Left of the two black keys.', points: 1, options: [{ id: id(11), label: 'This one', correct: true }, { id: id(12), label: 'That one', correct: false }], answers: [] },
      { id: id(3), kind: 'short', prompt: 'Name the scale', explanation: '', points: 2, options: [], answers: ['C major', 'Do majeur'] },
    ],
  };

  it('round-trips a saved quiz, keeping every id', () => {
    const state = fromDraft(draft);
    const input = toQuizInput(state);
    expect(input).toEqual({
      passPercent: 70,
      maxAttempts: 3,
      questions: [
        { id: id(1), kind: 'single', prompt: 'Which key is C?', explanation: 'Left of the two black keys.', points: 1, options: [{ id: id(11), label: 'This one', correct: true }, { id: id(12), label: 'That one', correct: false }], answers: [] },
        { id: id(3), kind: 'short', prompt: 'Name the scale', explanation: '', points: 2, options: [], answers: ['C major', 'Do majeur'] },
      ],
    });
    expect(quizChanged(state, fromDraft(draft))).toBe(false);
    expect(quizChanged({ ...state, passPercent: 80 }, fromDraft(draft))).toBe(true);
    expect(checkQuiz(state)).toEqual({ input });
  });

  it('starts new questions blank, with two choices or one accepted answer, and no ids', () => {
    const choice = newQuestion('multiple');
    expect(choice.options).toHaveLength(2);
    expect(choice.answers).toEqual([]);
    expect(choice.id).toBeUndefined();
    const text = newQuestion('short');
    expect(text.options).toEqual([]);
    expect(text.answers).toEqual(['']);
    expect(newQuestion('single').key).not.toBe(newQuestion('single').key);
  });

  it('keeps between 2 and 10 choices', () => {
    let question = newQuestion('single');
    question = removeChoice(question, question.options[0].key);
    expect(question.options).toHaveLength(2);
    for (let i = 0; i < 12; i++) question = addChoice(question);
    expect(question.options).toHaveLength(10);
  });

  it('allows one right choice for single choice, and any for multiple choice', () => {
    let question = newQuestion('single');
    question = addChoice(question);
    const [a, b, c] = question.options.map((option) => option.key);
    question = markCorrect(question, a, true);
    question = markCorrect(question, c, true);
    expect(question.options.map((option) => option.correct)).toEqual([false, false, true]);

    let multi = switchChoiceKind(question, 'multiple');
    multi = markCorrect(multi, a, true);
    expect(multi.options.map((option) => option.correct)).toEqual([true, false, true]);
    // Back to single choice: only the first right choice stays right.
    expect(switchChoiceKind(multi, 'single').options.map((option) => option.correct)).toEqual([true, false, false]);
    expect(markCorrect(multi, b, true).options.filter((option) => option.correct)).toHaveLength(3);
  });

  it('moves questions up and down within the list', () => {
    const list = ['a', 'b', 'c'];
    expect(moveQuestion(list, 0, 1)).toEqual(['b', 'a', 'c']);
    expect(moveQuestion(list, 2, -1)).toEqual(['a', 'c', 'b']);
    expect(moveQuestion(list, 0, -1)).toBe(list);
    expect(moveQuestion(list, 2, 1)).toBe(list);
  });

  it('puts each problem next to the question it belongs to', () => {
    const state = {
      passPercent: 120,
      maxAttempts: null,
      questions: [
        { ...newQuestion('single'), prompt: '' },
        { ...newQuestion('short'), prompt: 'Name the scale', answers: [''] },
        { ...newQuestion('multiple'), prompt: 'Pick', points: '' },
        { ...newQuestion('short'), prompt: 'Spell it', answers: ['C', '  '] },
      ],
    };
    state.questions[0].options[0].label = 'Yes';
    const { errors, input } = checkQuiz(state);
    expect(input).toBeUndefined();
    expect(errors.settings.passPercent).toBe('Use a whole number from 0 to 100');
    expect(errors.questions[0].prompt).toBe('Write the question');
    expect(errors.questions[0].options).toBe('Mark exactly one choice as correct');
    expect(errors.questions[0].option).toEqual({ 1: 'Write the answer' });
    expect(errors.questions[1].answers).toBe('Add at least one accepted answer');
    expect(errors.questions[2].points).toBe('Use a whole number from 1 to 100');
    expect(errors.questions[2].options).toBe('Mark at least one choice as correct');
    expect(errors.questions[3].answer).toEqual({ 1: 'Write the answer, or remove it' });
    expect(hasQuizErrors(errors)).toBe(true);
  });

  it("reads the API's field details the same way", () => {
    const errors = quizErrors([
      { path: 'questions.1.options', message: 'Give at least two choices' },
      { path: 'questions.0.options.2.label', message: 'Write the answer' },
      { path: 'maxAttempts', message: 'Too big' },
      { path: '', message: 'Something else' },
    ]);
    expect(errors.questions[1].options).toBe('Give at least two choices');
    expect(errors.questions[0].option[2]).toBe('Write the answer');
    expect(errors.settings.maxAttempts).toBe('Use a whole number from 1 to 100');
    expect(errors.form).toBe('Something else');
    expect(hasQuizErrors(quizErrors([]))).toBe(false);
  });
});
