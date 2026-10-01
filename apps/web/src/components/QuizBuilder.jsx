import { useEffect, useId, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { keys } from '../lib/courses.js';
import { plural } from '../lib/format.js';
import { errorMessage } from '../lib/forms.js';
import { getQuizDraft, saveQuiz } from '../lib/learning.js';
import {
  MAX_ACCEPTED_ANSWERS,
  MAX_CHOICES,
  MAX_QUESTIONS,
  MIN_CHOICES,
  QUESTION_KIND_LABELS,
  addChoice,
  checkQuiz,
  fromDraft,
  markCorrect,
  moveQuestion,
  newQuestion,
  quizChanged,
  quizErrors,
  removeChoice,
  switchChoiceKind,
  updateQuestion,
} from '../lib/quiz.js';
import { toast } from '../lib/toast.js';
import Button from './Button.jsx';
import { FormAlert, Select, SelectField, TextAreaField, TextField } from './Field.jsx';
import Icon from './Icon.jsx';
import { Block } from './Skeleton.jsx';
import { ErrorState } from './States.jsx';
import styles from './QuizBuilder.module.scss';

const ATTEMPT_CHOICES = [1, 2, 3, 4, 5, 10, 20, 50, 100];

/** A small square button for a question's or a choice's actions. */
function SmallButton({ icon, label, onClick, disabled, focusKey, tone }) {
  return (
    <button
      type="button"
      className={styles.small}
      data-tone={tone}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      data-focus={focusKey}
    >
      <Icon name={icon} size={17} />
    </button>
  );
}

/** A message under a field or group, tied to it by its id. */
function FieldError({ id, children }) {
  if (!children) return null;
  return (
    <p id={id} className={styles.error}>
      <Icon name="alert" size={15} />
      {children}
    </p>
  );
}

/** One question: its kind, prompt, choices (or accepted answers), points and explanation. */
function QuestionEditor({ question, index, count, errors = {}, onChange, onMove, onRemove }) {
  const id = useId();
  const choice = question.kind !== 'short';
  const set = (change) => onChange(question.key, change);
  const optionsError = `${id}-options-error`;
  const answersError = `${id}-answers-error`;

  return (
    <li className={styles.question} data-invalid={Object.keys(errors).length > 0 || undefined}>
      <div className={styles.questionHead}>
        <h4 className={styles.questionNumber} id={`${id}-title`}>
          Question {index + 1}
        </h4>
        {choice ? (
          <Select
            size="sm"
            aria-label={`Question ${index + 1}: type`}
            value={question.kind}
            options={[
              { value: 'single', label: QUESTION_KIND_LABELS.single },
              { value: 'multiple', label: QUESTION_KIND_LABELS.multiple },
            ]}
            onChange={(event) => onChange(question.key, (current) => switchChoiceKind(current, event.target.value))}
          />
        ) : (
          <span className={styles.kindLabel}>{QUESTION_KIND_LABELS.short}</span>
        )}
        <span className={styles.questionActions}>
          <SmallButton icon="arrowUp" label={`Move question ${index + 1} up`} onClick={() => onMove(index, -1)} disabled={index === 0} focusKey={`${question.key}:up`} />
          <SmallButton
            icon="arrowDown"
            label={`Move question ${index + 1} down`}
            onClick={() => onMove(index, 1)}
            disabled={index === count - 1}
            focusKey={`${question.key}:down`}
          />
          <SmallButton icon="trash" tone="danger" label={`Delete question ${index + 1}`} onClick={() => onRemove(index)} />
        </span>
      </div>

      <TextAreaField
        label="Question"
        rows={2}
        maxLength={2000}
        value={question.prompt}
        error={errors.prompt}
        onChange={(event) => set({ prompt: event.target.value })}
        data-field={`${question.key}:prompt`}
      />

      {choice ? (
        <fieldset className={styles.group} aria-describedby={errors.options ? optionsError : undefined}>
          <legend className={styles.groupLabel}>
            Choices <span className={styles.groupHint}>{question.kind === 'single' ? 'Mark the right one' : 'Mark every right one'}</span>
          </legend>
          <ol className={styles.choices}>
            {question.options.map((option, at) => {
              const errorId = `${id}-option-${at}-error`;
              const problem = errors.option?.[at];
              return (
                <li key={option.key} className={styles.choice}>
                  <label className={styles.correct} title={question.kind === 'single' ? 'The right answer' : 'A right answer'}>
                    <input
                      type={question.kind === 'single' ? 'radio' : 'checkbox'}
                      name={`${id}-correct`}
                      checked={option.correct}
                      onChange={(event) => set((current) => markCorrect(current, option.key, event.target.checked))}
                    />
                    <span className="visually-hidden">
                      Choice {at + 1} is {question.kind === 'single' ? 'the right answer' : 'right'}
                    </span>
                  </label>
                  <div className={styles.choiceField}>
                    <input
                      className={`${styles.input} ${problem ? styles.invalid : ''}`}
                      value={option.label}
                      maxLength={500}
                      autoComplete="off"
                      aria-label={`Choice ${at + 1}`}
                      aria-invalid={problem ? true : undefined}
                      aria-describedby={problem ? errorId : undefined}
                      placeholder={`Choice ${at + 1}`}
                      onChange={(event) =>
                        set((current) => ({ options: current.options.map((item) => (item.key === option.key ? { ...item, label: event.target.value } : item)) }))
                      }
                      data-field={`${question.key}:option:${at}`}
                    />
                    <FieldError id={errorId}>{problem}</FieldError>
                  </div>
                  <SmallButton
                    icon="close"
                    label={`Remove choice ${at + 1}`}
                    disabled={question.options.length <= MIN_CHOICES}
                    onClick={() => onChange(question.key, (current) => removeChoice(current, option.key), { focus: `${question.key}:option:${Math.max(0, at - 1)}` })}
                  />
                </li>
              );
            })}
          </ol>
          <FieldError id={optionsError}>{errors.options}</FieldError>
          {question.options.length < MAX_CHOICES && (
            <button
              type="button"
              className={styles.add}
              onClick={() => onChange(question.key, (current) => addChoice(current), { focus: `${question.key}:option:${question.options.length}` })}
            >
              <Icon name="plus" size={16} />
              Add a choice
            </button>
          )}
        </fieldset>
      ) : (
        <fieldset className={styles.group} aria-describedby={`${id}-answers-hint${errors.answers ? ` ${answersError}` : ''}`}>
          <legend className={styles.groupLabel}>Accepted answers</legend>
          <p id={`${id}-answers-hint`} className={styles.groupHint}>
            Answers are compared without regard to capitals, accents or spacing.
          </p>
          <ol className={styles.choices}>
            {question.answers.map((answer, at) => {
              const errorId = `${id}-answer-${at}-error`;
              const problem = errors.answer?.[at];
              return (
                <li key={at} className={styles.choice}>
                  <div className={styles.choiceField}>
                    <input
                      className={`${styles.input} ${problem ? styles.invalid : ''}`}
                      value={answer}
                      maxLength={200}
                      autoComplete="off"
                      aria-label={`Accepted answer ${at + 1}`}
                      aria-invalid={problem ? true : undefined}
                      aria-describedby={problem ? errorId : undefined}
                      placeholder={at === 0 ? 'The answer' : 'Another way to write it'}
                      onChange={(event) => set((current) => ({ answers: current.answers.map((item, i) => (i === at ? event.target.value : item)) }))}
                      data-field={`${question.key}:answer:${at}`}
                    />
                    <FieldError id={errorId}>{problem}</FieldError>
                  </div>
                  <SmallButton
                    icon="close"
                    label={`Remove accepted answer ${at + 1}`}
                    disabled={question.answers.length <= 1}
                    onClick={() =>
                      onChange(question.key, (current) => ({ answers: current.answers.filter((_, i) => i !== at) }), {
                        focus: `${question.key}:answer:${Math.max(0, at - 1)}`,
                      })
                    }
                  />
                </li>
              );
            })}
          </ol>
          <FieldError id={answersError}>{errors.answers}</FieldError>
          {question.answers.length < MAX_ACCEPTED_ANSWERS && (
            <button
              type="button"
              className={styles.add}
              onClick={() => onChange(question.key, (current) => ({ answers: [...current.answers, ''] }), { focus: `${question.key}:answer:${question.answers.length}` })}
            >
              <Icon name="plus" size={16} />
              Add another answer
            </button>
          )}
        </fieldset>
      )}

      <div className={styles.pointsRow}>
        <TextField
          label="Points"
          type="number"
          inputMode="numeric"
          min={1}
          max={100}
          step={1}
          value={question.points}
          error={errors.points}
          onChange={(event) => set({ points: event.target.value })}
          className={styles.points}
          data-field={`${question.key}:points`}
        />
      </div>
      <TextAreaField
        label="Explanation (optional)"
        rows={2}
        maxLength={2000}
        value={question.explanation}
        error={errors.explanation}
        hint="Shown with the right answer, once a student passes or has no attempts left."
        onChange={(event) => set({ explanation: event.target.value })}
      />
    </li>
  );
}

/** The order fields are in on the page, for moving focus to the first one with a problem. */
function firstProblem(state, errors) {
  if (errors.settings.passPercent) return 'passPercent';
  if (errors.settings.maxAttempts) return 'maxAttempts';
  for (const [index, question] of state.questions.entries()) {
    const problem = errors.questions[index];
    if (!problem) continue;
    if (problem.prompt) return `${question.key}:prompt`;
    const option = Object.keys(problem.option ?? {})[0];
    if (option !== undefined) return `${question.key}:option:${option}`;
    if (problem.options) return `${question.key}:option:0`;
    const answer = Object.keys(problem.answer ?? {})[0];
    if (answer !== undefined) return `${question.key}:answer:${answer}`;
    if (problem.answers) return `${question.key}:answer:0`;
    if (problem.points) return `${question.key}:points`;
  }
  return null;
}

function Builder({ draft, onSave, onDirtyChange }) {
  const [saved, setSaved] = useState(() => fromDraft(draft));
  const [state, setState] = useState(saved);
  const [errors, setErrors] = useState(null);
  const [busy, setBusy] = useState(false);
  const [kind, setKind] = useState('single');
  const [announcement, setAnnouncement] = useState('');
  const root = useRef(null);
  const pendingFocus = useRef(null);
  const dirty = quizChanged(state, saved);

  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);

  // Focus follows the change: a new question's prompt, a new choice, the same arrow after a move.
  useEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    pendingFocus.current = null;
    const find = (name) => root.current?.querySelector(`[data-field="${name}"], [data-focus="${name}"]`);
    const element = find(target);
    if (element && !element.disabled) element.focus();
    else if (/:(up|down)$/.test(target)) find(target.endsWith(':up') ? target.replace(/:up$/, ':down') : target.replace(/:down$/, ':up'))?.focus();
    else root.current?.querySelector('[data-focus="add-question"]')?.focus();
  });

  /** Applies a change; once problems have been shown, they're checked again as they're fixed. */
  const apply = (next, focus) => {
    pendingFocus.current = focus ?? null;
    setState(next);
    if (errors) setErrors(checkQuiz(next).errors ?? null);
  };

  const changeQuestion = (key, change, { focus } = {}) => apply({ ...state, questions: updateQuestion(state.questions, key, change) }, focus);
  const move = (index, delta) => {
    const key = state.questions[index].key;
    apply({ ...state, questions: moveQuestion(state.questions, index, delta) }, `${key}:${delta < 0 ? 'up' : 'down'}`);
    setAnnouncement(`Question moved to position ${index + delta + 1} of ${state.questions.length}.`);
  };
  const remove = (index) => {
    const next = state.questions.filter((_, i) => i !== index);
    const neighbour = next[index] ?? next[index - 1];
    apply({ ...state, questions: next }, neighbour ? `${neighbour.key}:prompt` : 'add-question');
    setAnnouncement(`Question ${index + 1} deleted. Save the quiz to keep the change.`);
  };
  const add = () => {
    const question = newQuestion(kind);
    apply({ ...state, questions: [...state.questions, question] }, `${question.key}:prompt`);
  };

  const showProblems = (found) => {
    setErrors(found);
    const field = firstProblem(state, found);
    if (field) root.current?.querySelector(`[data-field="${field}"]`)?.focus();
  };

  const submit = async (event) => {
    event.preventDefault();
    if (busy) return;
    const check = checkQuiz(state);
    if (check.errors) {
      showProblems(check.errors);
      return;
    }
    setBusy(true);
    try {
      const next = fromDraft(await onSave(check.input));
      setSaved(next);
      setState(next);
      setErrors(null);
      toast('Quiz saved');
    } catch (error) {
      if (error?.details?.length) showProblems(quizErrors(error.details));
      else setErrors({ settings: {}, questions: {}, form: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  };

  const shown = errors ?? { settings: {}, questions: {}, form: null };
  const attemptOptions = [...new Set([...ATTEMPT_CHOICES, ...(Number.isInteger(Number(state.maxAttempts)) && state.maxAttempts ? [Number(state.maxAttempts)] : [])])]
    .sort((a, b) => a - b)
    .map((n) => ({ value: String(n), label: plural(n, 'attempt') }));
  const problemCount = Object.keys(shown.questions).length;

  return (
    <form ref={root} className={styles.builder} onSubmit={submit} noValidate>
      {draft.attemptCount > 0 && (
        <p className={styles.note}>
          <Icon name="info" size={18} />
          <span>
            Students have made {plural(draft.attemptCount, 'attempt')} so far. Their scores won't change: edits apply to new attempts.
          </span>
        </p>
      )}
      <FormAlert>{shown.form}</FormAlert>

      <div className={styles.settings}>
        <TextField
          label="Pass mark (%)"
          type="number"
          inputMode="numeric"
          min={0}
          max={100}
          step={1}
          value={state.passPercent}
          error={shown.settings.passPercent}
          hint="The share of the points needed to pass."
          onChange={(event) => apply({ ...state, passPercent: event.target.value })}
          data-field="passPercent"
        />
        <SelectField
          label="Attempts"
          value={state.maxAttempts === null || state.maxAttempts === '' ? 'unlimited' : String(state.maxAttempts)}
          options={[{ value: 'unlimited', label: 'Unlimited' }, ...attemptOptions]}
          error={shown.settings.maxAttempts}
          hint="How many times each student can take it."
          onChange={(event) => apply({ ...state, maxAttempts: event.target.value === 'unlimited' ? null : Number(event.target.value) })}
          data-field="maxAttempts"
        />
      </div>

      {state.questions.length === 0 ? (
        <p className={styles.empty}>No questions yet. Choose a type and add the first one.</p>
      ) : (
        <ol className={styles.questions} aria-label="Questions">
          {state.questions.map((question, index) => (
            <QuestionEditor
              key={question.key}
              question={question}
              index={index}
              count={state.questions.length}
              errors={shown.questions[index]}
              onChange={changeQuestion}
              onMove={move}
              onRemove={remove}
            />
          ))}
        </ol>
      )}

      {state.questions.length < MAX_QUESTIONS && (
        <div className={styles.addQuestion}>
          <SelectField
            label="New question"
            value={kind}
            options={Object.entries(QUESTION_KIND_LABELS).map(([value, label]) => ({ value, label }))}
            onChange={(event) => setKind(event.target.value)}
            className={styles.kindField}
          />
          <Button icon="plus" onClick={add} data-focus="add-question">
            Add question
          </Button>
        </div>
      )}

      <div className={styles.saveBar}>
        <Button type="submit" variant="primary" busy={busy} disabled={!dirty && !errors}>
          Save quiz
        </Button>
        <p className={styles.saveState} aria-live="polite">
          {problemCount > 0
            ? `${plural(problemCount, 'question')} ${problemCount === 1 ? 'needs' : 'need'} attention.`
            : dirty
              ? 'Unsaved changes'
              : `${plural(state.questions.length, 'question')}, all saved`}
        </p>
      </div>
      <p className="visually-hidden" aria-live="polite">
        {announcement}
      </p>
    </form>
  );
}

/**
 * The quiz builder, in a quiz's lesson drawer: the pass mark and the number of attempts, and the
 * questions (single choice, multiple choice or short answer), each with its choices and the right
 * ones (or its accepted answers), points and an explanation, in an order that can be changed.
 * "Save quiz" sends the whole quiz, keeping every question's and choice's id so their statistics
 * carry over; problems (found here or by the API) show next to the question they're about.
 * `onDirtyChange` tells the drawer about unsaved changes.
 */
export default function QuizBuilder({ school, course, lessonId, onDirtyChange }) {
  const queryClient = useQueryClient();
  const slug = school.slug;
  const key = keys.quizDraft(slug, course.slug, lessonId);
  const draft = useQuery({ queryKey: key, queryFn: ({ signal }) => getQuizDraft(slug, course.slug, lessonId, signal), staleTime: Infinity });

  if (draft.isError) return <ErrorState title="Couldn't load the quiz" error={draft.error} onRetry={() => draft.refetch()} />;
  if (draft.isPending)
    return (
      <div className={styles.builder} aria-busy="true">
        <Block height="4.5rem" radius="var(--radius-md)" />
        <Block height="12rem" radius="var(--radius-md)" />
      </div>
    );

  const save = async (input) => {
    const saved = await saveQuiz(slug, course.slug, lessonId, input);
    queryClient.setQueryData(key, saved);
    queryClient.invalidateQueries({ queryKey: keys.quiz(slug, course.slug, lessonId) });
    queryClient.invalidateQueries({ queryKey: keys.lessonInsights(slug, course.slug, lessonId) });
    return saved;
  };

  return <Builder draft={draft.data} onSave={save} onDirtyChange={onDirtyChange} />;
}
