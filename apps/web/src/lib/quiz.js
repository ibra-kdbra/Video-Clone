import { quizInput } from '@grand/contracts';

/**
 * Quizzes in the browser, without the React: answers while taking one, and the builder's working
 * copy for its editors (with its checks, the API's own). Every helper returns new objects.
 */

export const MIN_CHOICES = 2;
export const MAX_CHOICES = 10;
export const MAX_ACCEPTED_ANSWERS = 10;
export const MAX_QUESTIONS = 100;

export const QUESTION_KIND_LABELS = { single: 'Single choice', multiple: 'Multiple choice', short: 'Short answer' };

// Taking a quiz ------------------------------------------------------------------------------------

/**
 * Answers by question id: the chosen option ids (always an array) for choice questions, the text
 * for short answers. A single-choice question keeps one choice; ticking a multiple-choice option
 * adds it, unticking removes it.
 */
export function chooseOption(answers, question, optionId, checked = true) {
  const current = Array.isArray(answers[question.id]) ? answers[question.id] : [];
  let next;
  if (question.kind === 'single') next = checked ? [optionId] : current.filter((id) => id !== optionId);
  else next = checked ? [...new Set([...current, optionId])] : current.filter((id) => id !== optionId);
  // In the quiz's own order, so the answer reads the same whichever was ticked first.
  const order = question.options.map((option) => option.id);
  next.sort((a, b) => order.indexOf(a) - order.indexOf(b));
  return { ...answers, [question.id]: next };
}

export const writeAnswer = (answers, questionId, text) => ({ ...answers, [questionId]: String(text) });

/** Whether a question has an answer: a choice ticked, or some text written. */
export function isAnswered(question, answer) {
  if (question.kind === 'short') return typeof answer === 'string' && answer.trim().length > 0;
  return Array.isArray(answer) && answer.length > 0;
}

/** The questions left without an answer, in order. */
export const unanswered = (questions, answers) => questions.filter((question) => !isAnswered(question, answers[question.id]));

/** The body of POST …/quiz/attempts: every question, unanswered ones as an empty answer. */
export function attemptInput(questions, answers) {
  return {
    answers: Object.fromEntries(
      questions.map((question) => {
        const answer = answers[question.id];
        if (question.kind === 'short') return [question.id, typeof answer === 'string' ? answer.trim().slice(0, 500) : ''];
        const known = new Set(question.options.map((option) => option.id));
        return [question.id, Array.isArray(answer) ? answer.filter((id) => known.has(id)) : []];
      }),
    ),
  };
}

/** "Choose one", "Choose all that apply", "Type your answer": what each kind asks for. */
export const QUESTION_HINTS = { single: 'Choose one', multiple: 'Choose all that apply', short: 'Type your answer' };

/** How an attempt went, in a few words: "8 of 10 points · 80%". */
export const scoreLine = (attempt) => `${attempt.score} of ${attempt.maxScore} ${attempt.maxScore === 1 ? 'point' : 'points'} · ${attempt.percent}%`;

/** Whether the right answers came back with this result (passed, or no attempts left). */
export const revealsAnswers = (result) =>
  result.questions.some((question) => question.correctOptionIds !== null || question.acceptedAnswers !== null || question.explanation !== null);

/** "3 attempts left", "1 attempt left", "No attempts left", "Unlimited attempts". */
export function attemptsLeftLabel(attemptsLeft) {
  if (attemptsLeft === null || attemptsLeft === undefined) return 'Unlimited attempts';
  if (attemptsLeft === 0) return 'No attempts left';
  return `${attemptsLeft} ${attemptsLeft === 1 ? 'attempt' : 'attempts'} left`;
}

// Building a quiz ----------------------------------------------------------------------------------

let counter = 0;
/** A key for React lists; questions and choices not saved yet have no id. */
const newKey = (prefix) => `${prefix}-${Date.now().toString(36)}-${(counter += 1)}`;

const choice = (label = '', correct = false, id) => ({ key: id ?? newKey('o'), ...(id && { id }), label, correct });

/** A new, empty question of a kind: two blank choices, or one blank accepted answer. */
export function newQuestion(kind) {
  return {
    key: newKey('q'),
    kind,
    prompt: '',
    explanation: '',
    points: 1,
    options: kind === 'short' ? [] : [choice(), choice()],
    answers: kind === 'short' ? [''] : [],
  };
}

/** The builder's working copy of a saved quiz (QuizDraft), keeping every id so statistics carry over. */
export function fromDraft(draft) {
  return {
    passPercent: draft.passPercent,
    maxAttempts: draft.maxAttempts,
    questions: draft.questions.map((question) => ({
      key: question.id,
      id: question.id,
      kind: question.kind,
      prompt: question.prompt,
      explanation: question.explanation ?? '',
      points: question.points,
      options: question.options.map((option) => choice(option.label, option.correct, option.id)),
      answers: question.kind === 'short' ? (question.answers.length ? [...question.answers] : ['']) : [],
    })),
  };
}

const toPoints = (value) => {
  const n = typeof value === 'number' ? value : Number(String(value).trim());
  return String(value).trim() === '' || !Number.isFinite(n) ? Number.NaN : n;
};

/** The body of PUT …/quiz (QuizInput): the whole quiz, ids kept, the builder's keys dropped. */
export function toQuizInput(state) {
  return {
    passPercent: toPoints(state.passPercent),
    maxAttempts: state.maxAttempts === null || state.maxAttempts === '' ? null : toPoints(state.maxAttempts),
    questions: state.questions.map((question) => ({
      ...(question.id && { id: question.id }),
      kind: question.kind,
      prompt: question.prompt.trim(),
      explanation: question.explanation.trim(),
      points: toPoints(question.points),
      options:
        question.kind === 'short'
          ? []
          : question.options.map((option) => ({ ...(option.id && { id: option.id }), label: option.label.trim(), correct: option.correct })),
      // Blank lines in the list of accepted answers are left out, but an all-blank list is sent as
      // one blank answer, so the check says what's missing.
      answers: question.kind === 'short' ? keepWritten(question.answers) : [],
    })),
  };
}

function keepWritten(answers) {
  const written = answers.map((answer) => answer.trim()).filter(Boolean);
  return written.length ? written : [];
}

/** Whether the working copy differs from what was saved. */
export const quizChanged = (state, saved) => JSON.stringify(toQuizInput(state)) !== JSON.stringify(toQuizInput(saved));

/** Moves the question at `index` one place up (-1) or down (+1). */
export function moveQuestion(questions, index, delta) {
  const to = index + delta;
  if (to < 0 || to >= questions.length) return questions;
  const next = [...questions];
  const [moved] = next.splice(index, 1);
  next.splice(to, 0, moved);
  return next;
}

/** A question with one change applied (by key). */
export const updateQuestion = (questions, key, change) =>
  questions.map((question) => (question.key === key ? { ...question, ...(typeof change === 'function' ? change(question) : change) } : question));

export function addChoice(question) {
  if (question.options.length >= MAX_CHOICES) return question;
  return { ...question, options: [...question.options, choice()] };
}

export function removeChoice(question, optionKey) {
  if (question.options.length <= MIN_CHOICES) return question;
  return { ...question, options: question.options.filter((option) => option.key !== optionKey) };
}

/** Marks a choice right or wrong: a single-choice question has exactly one right choice. */
export function markCorrect(question, optionKey, correct) {
  return {
    ...question,
    options: question.options.map((option) =>
      option.key === optionKey ? { ...option, correct } : question.kind === 'single' && correct ? { ...option, correct: false } : option,
    ),
  };
}

/**
 * Switches a choice question between single and multiple choice. Going to single keeps only the
 * first right choice.
 */
export function switchChoiceKind(question, kind) {
  if (question.kind === 'short' || kind === 'short' || kind === question.kind) return question;
  let seen = false;
  const options =
    kind === 'single'
      ? question.options.map((option) => {
          const keep = option.correct && !seen;
          if (option.correct) seen = true;
          return { ...option, correct: keep };
        })
      : question.options;
  return { ...question, kind, options };
}

// Checks -------------------------------------------------------------------------------------------

/** Issue paths from zod (arrays) or the API's details ("questions.2.options"), as arrays. */
const pathOf = (issue) => (Array.isArray(issue.path) ? issue.path.map(String) : String(issue.path ?? '').split('.').filter(Boolean));

// The number fields' limits, said plainly (zod's own wording is for developers).
const NUMBER_RULES = {
  passPercent: 'Use a whole number from 0 to 100',
  maxAttempts: 'Use a whole number from 1 to 100',
  points: 'Use a whole number from 1 to 100',
};

/**
 * Problems by where they belong: the settings (`passPercent`, `maxAttempts`), each question by
 * index (`prompt`, `points`, `explanation`, `options`, `answers`, and single choices or accepted
 * answers by their index in `option` and `answer`), and anything else as `form`.
 */
export function quizErrors(issues = []) {
  const errors = { settings: {}, questions: {}, form: null };
  for (const issue of issues) {
    const [first, index, field, at, inner] = pathOf(issue);
    if (first === 'passPercent' || first === 'maxAttempts') {
      errors.settings[first] ??= NUMBER_RULES[first];
    } else if (first === 'questions' && index !== undefined && /^\d+$/.test(index)) {
      const entry = (errors.questions[index] ??= {});
      if ((field === 'options' || field === 'answers') && at !== undefined && /^\d+$/.test(at)) {
        const bucket = (entry[field === 'options' ? 'option' : 'answer'] ??= {});
        bucket[at] ??= inner === 'correct' ? 'Mark it right or wrong' : issue.message;
      } else if (field) {
        entry[field] ??= NUMBER_RULES[field] ?? issue.message;
      } else {
        entry.prompt ??= issue.message;
      }
    } else {
      errors.form ??= issue.message;
    }
  }
  return errors;
}

export const hasQuizErrors = (errors) =>
  Boolean(errors.form) || Object.keys(errors.settings).length > 0 || Object.keys(errors.questions).length > 0;

/**
 * Checks the working copy with the API's own schema: `{ input }` when it can be saved, or
 * `{ errors }` (see quizErrors). Accepted answers left blank are caught here too, since they're
 * left out of what's sent.
 */
export function checkQuiz(state) {
  const input = toQuizInput(state);
  const result = quizInput.safeParse(input);
  const issues = result.success ? [] : [...result.error.issues];
  state.questions.forEach((question, index) => {
    if (question.kind === 'short') {
      question.answers.forEach((answer, at) => {
        if (!answer.trim() && question.answers.length > 1) issues.push({ path: ['questions', index, 'answers', at], message: 'Write the answer, or remove it' });
      });
      return;
    }
    // The schema checks the right choices only once everything else about the question is valid;
    // checked here too, everything wrong is said at once (with the schema's own words).
    const correct = question.options.filter((option) => option.correct).length;
    const path = ['questions', index, 'options'];
    if (question.options.length < MIN_CHOICES) issues.push({ path, message: 'Give at least two choices' });
    else if (question.kind === 'single' && correct !== 1) issues.push({ path, message: 'Mark exactly one choice as correct' });
    else if (question.kind === 'multiple' && correct < 1) issues.push({ path, message: 'Mark at least one choice as correct' });
  });
  return issues.length ? { errors: quizErrors(issues) } : { input: result.data };
}
