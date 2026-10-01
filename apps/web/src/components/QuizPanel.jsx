import { useEffect, useId, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { keys } from '../lib/courses.js';
import { formatDateTime, plural } from '../lib/format.js';
import { errorMessage } from '../lib/forms.js';
import { applyProgress, attemptQuiz, getQuiz, getQuizAttempt } from '../lib/learning.js';
import { QUESTION_HINTS, attemptInput, attemptsLeftLabel, chooseOption, revealsAnswers, scoreLine, unanswered, writeAnswer } from '../lib/quiz.js';
import { toast } from '../lib/toast.js';
import Badge from './Badge.jsx';
import Button from './Button.jsx';
import ConfirmDialog from './ConfirmDialog.jsx';
import Icon from './Icon.jsx';
import { Block } from './Skeleton.jsx';
import { ErrorState } from './States.jsx';
import styles from './QuizPanel.module.scss';

/** The quiz at a glance: questions, points, pass mark, attempts left and the best score so far. */
function Facts({ quiz, enrolled }) {
  return (
    <dl className={styles.facts}>
      <div>
        <dt>Questions</dt>
        <dd className="tabular">{quiz.questions.length}</dd>
      </div>
      <div>
        <dt>Points</dt>
        <dd className="tabular">{quiz.maxScore}</dd>
      </div>
      <div>
        <dt>Pass mark</dt>
        <dd className="tabular">{quiz.passPercent}%</dd>
      </div>
      <div>
        <dt>Attempts</dt>
        <dd className="tabular">{enrolled ? attemptsLeftLabel(quiz.attemptsLeft) : quiz.maxAttempts === null ? 'Unlimited' : plural(quiz.maxAttempts, 'attempt')}</dd>
      </div>
      {enrolled && (
        <div>
          <dt>Best score</dt>
          <dd className="tabular">{quiz.bestPercent === null ? 'None yet' : `${quiz.bestPercent}%`}</dd>
        </div>
      )}
    </dl>
  );
}

/** The attempts so far, newest first, each of which can be looked at again. */
function History({ attempts, onReview }) {
  if (attempts.length === 0) return null;
  return (
    <section className={styles.history} aria-labelledby="attempts-title">
      <h3 id="attempts-title" className={styles.subTitle}>
        Your attempts
      </h3>
      <ol className={styles.attempts} reversed>
        {attempts.map((attempt, index) => (
          <li key={attempt.id} className={styles.attempt}>
            <span className={`${styles.attemptNumber} tabular`}>Attempt {attempts.length - index}</span>
            <span className={`${styles.attemptScore} tabular`}>{scoreLine(attempt)}</span>
            <Badge tone={attempt.passed ? 'success' : 'neutral'} icon={attempt.passed ? 'check' : undefined}>
              {attempt.passed ? 'Passed' : 'Not passed'}
            </Badge>
            <span className={styles.attemptDate}>{formatDateTime(attempt.createdAt)}</span>
            <Button size="sm" variant="ghost" onClick={() => onReview({ id: attempt.id, number: attempts.length - index })} aria-label={`Review attempt ${attempts.length - index}`}>
              Review
            </Button>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** The questions as students see them, without the answers: for editors and preview viewers. */
function ReadOnlyQuestions({ quiz }) {
  return (
    <ol className={styles.questions}>
      {quiz.questions.map((question, index) => (
        <li key={question.id} className={styles.question}>
          <p className={styles.legend}>
            <span className={`${styles.questionMeta} tabular`}>
              Question {index + 1} of {quiz.questions.length} · {plural(question.points, 'point')}
            </span>
            <span className={styles.prompt}>{question.prompt}</span>
          </p>
          <p className={styles.hint}>{QUESTION_HINTS[question.kind]}</p>
          {question.kind === 'short' ? (
            <p className={styles.readOnlyAnswer}>Students type their answer.</p>
          ) : (
            <ul className={styles.readOnlyOptions}>
              {question.options.map((option) => (
                <li key={option.id}>
                  <span className={question.kind === 'single' ? styles.radioMark : styles.checkMark} aria-hidden="true" />
                  {option.label}
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ol>
  );
}

/** Taking the quiz: every question in one form, handed in together. */
function QuizForm({ quiz, answers, onChange, onHandIn, onCancel, busy, headingRef, attemptNumber }) {
  const formId = useId();
  const [confirm, setConfirm] = useState(false);
  const left = unanswered(quiz.questions, answers);

  const submit = (event) => {
    event.preventDefault();
    if (busy) return;
    if (left.length > 0) setConfirm(true);
    else onHandIn();
  };

  return (
    <form className={styles.form} onSubmit={submit} aria-labelledby={`${formId}-title`} noValidate>
      <div className={styles.formHead}>
        <h2 id={`${formId}-title`} ref={headingRef} tabIndex={-1} className={styles.title}>
          Attempt {attemptNumber}
        </h2>
        <p className={styles.muted} aria-live="polite">
          {left.length === 0 ? 'Every question has an answer. Hand in when you are ready.' : `${plural(left.length, 'question')} still to answer.`}
        </p>
      </div>

      <ol className={styles.questions}>
        {quiz.questions.map((question, index) => {
          const answer = answers[question.id];
          const hintId = `${formId}-${question.id}-hint`;
          return (
            <li key={question.id} className={styles.question}>
              <fieldset className={styles.fieldset} aria-describedby={hintId}>
                <legend className={styles.legend}>
                  <span className={`${styles.questionMeta} tabular`}>
                    Question {index + 1} of {quiz.questions.length} · {plural(question.points, 'point')}
                  </span>
                  <span className={styles.prompt}>{question.prompt}</span>
                </legend>
                <p id={hintId} className={styles.hint}>
                  {QUESTION_HINTS[question.kind]}
                </p>
                {question.kind === 'short' ? (
                  <input
                    type="text"
                    className={styles.text}
                    value={typeof answer === 'string' ? answer : ''}
                    maxLength={500}
                    autoComplete="off"
                    aria-label={`Your answer to question ${index + 1}`}
                    onChange={(event) => onChange(writeAnswer(answers, question.id, event.target.value))}
                  />
                ) : (
                  <div className={styles.options}>
                    {question.options.map((option) => {
                      const checked = Array.isArray(answer) && answer.includes(option.id);
                      return (
                        <label key={option.id} className={styles.option} data-checked={checked || undefined}>
                          <input
                            type={question.kind === 'single' ? 'radio' : 'checkbox'}
                            name={`${formId}-${question.id}`}
                            value={option.id}
                            checked={checked}
                            onChange={(event) => onChange(chooseOption(answers, question, option.id, event.target.checked))}
                          />
                          <span>{option.label}</span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </fieldset>
            </li>
          );
        })}
      </ol>

      <div className={styles.actions}>
        <Button type="submit" variant="primary" icon="send" busy={busy}>
          Hand in
        </Button>
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>

      <ConfirmDialog
        open={confirm}
        tone="primary"
        title={`Hand in with ${plural(left.length, 'question')} unanswered?`}
        confirmLabel="Hand in"
        cancelLabel="Keep answering"
        busy={busy}
        onConfirm={() => {
          setConfirm(false);
          onHandIn();
        }}
        onClose={() => setConfirm(false)}
      >
        <p>Questions without an answer count as wrong.</p>
      </ConfirmDialog>
    </form>
  );
}

/** "C major", "First, Third", or "No answer": what was handed in for one question. */
function answerText(question, answer) {
  if (question.kind === 'short') return typeof answer === 'string' && answer.trim() ? answer.trim() : 'No answer';
  const chosen = question.options.filter((option) => Array.isArray(answer) && answer.includes(option.id)).map((option) => option.label);
  return chosen.length ? chosen.join(', ') : 'No answer';
}

/**
 * How an attempt went, question by question: the one just handed in, or a past one (`number`).
 * Right answers and explanations only when the API reveals them.
 */
function QuizResult({ quiz, result, number, headingRef, onRetry, onDone }) {
  const revealed = revealsAnswers(result);
  const answers = result.answers ?? {};
  const byId = new Map(quiz.questions.map((question) => [question.id, question]));
  const canRetry = result.attemptsLeft === null || result.attemptsLeft > 0;
  return (
    <section className={styles.result} aria-labelledby="result-title">
      <div className={styles.resultHead} data-passed={result.passed || undefined}>
        <span className={styles.resultIcon}>
          <Icon name={result.passed ? 'checkCircle' : 'refresh'} size={28} />
        </span>
        <div>
          <h2 id="result-title" ref={headingRef} tabIndex={-1} className={styles.title}>
            {number ? `Attempt ${number}: ${result.passed ? 'passed' : 'not passed'}` : result.passed ? 'You passed' : 'Not passed this time'}
          </h2>
          <p className={`${styles.score} tabular`}>
            {scoreLine(result)} · Pass mark {quiz.passPercent}%{number ? ` · ${formatDateTime(result.createdAt)}` : ''}
          </p>
          <p className={styles.muted}>{attemptsLeftLabel(result.attemptsLeft)}.</p>
        </div>
      </div>

      {!revealed && <p className={styles.note}>The right answers and explanations are shown once you pass, or when you have no attempts left.</p>}

      <ol className={styles.questions}>
        {result.questions.map((mark, index) => {
          const question = byId.get(mark.questionId);
          // A question removed since this attempt.
          if (!question) return null;
          const right = question.kind === 'short' ? mark.acceptedAnswers : question.options.filter((option) => mark.correctOptionIds?.includes(option.id)).map((option) => option.label);
          return (
            <li key={mark.questionId} className={styles.question} data-correct={mark.correct}>
              <p className={styles.legend}>
                <span className={styles.markLine}>
                  <span className={styles.mark} data-correct={mark.correct}>
                    <Icon name={mark.correct ? 'check' : 'close'} size={14} />
                  </span>
                  <span className={`${styles.questionMeta} tabular`}>
                    Question {index + 1} · {mark.correct ? 'Right' : 'Wrong'} · {mark.points} of {plural(mark.maxPoints, 'point')}
                  </span>
                </span>
                <span className={styles.prompt}>{question.prompt}</span>
              </p>
              <dl className={styles.answers}>
                <div>
                  <dt>Your answer</dt>
                  <dd>{answerText(question, answers[question.id])}</dd>
                </div>
                {right && right.length > 0 && (
                  <div>
                    <dt>{question.kind === 'short' ? (right.length > 1 ? 'Accepted answers' : 'Accepted answer') : right.length > 1 ? 'Right answers' : 'Right answer'}</dt>
                    <dd>{right.join(', ')}</dd>
                  </div>
                )}
              </dl>
              {mark.explanation && <p className={styles.explanation}>{mark.explanation}</p>}
            </li>
          );
        })}
      </ol>

      <div className={styles.actions}>
        {canRetry && (
          <Button variant="primary" icon="replay" onClick={onRetry}>
            Try again
          </Button>
        )}
        <Button variant={canRetry ? 'ghost' : 'secondary'} onClick={onDone}>
          Back to the quiz
        </Button>
      </div>
    </section>
  );
}

/** A past attempt, loaded when asked for. */
function PastAttempt({ quiz, attempt, queryKey, load, headingRef, onRetry, onDone }) {
  const result = useQuery({ queryKey, queryFn: ({ signal }) => load(signal), staleTime: 30_000 });
  useEffect(() => {
    if (result.data) headingRef.current?.focus();
  }, [result.data, headingRef]);
  if (result.isError) return <ErrorState title="Couldn't load this attempt" error={result.error} onRetry={() => result.refetch()} />;
  if (result.isPending)
    return (
      <div aria-busy="true">
        <Block width="40%" height="1.4rem" />
        <Block height="6rem" radius="var(--radius-md)" />
      </div>
    );
  return <QuizResult quiz={quiz} result={result.data} number={attempt.number} headingRef={headingRef} onRetry={onRetry} onDone={onDone} />;
}

/**
 * A quiz on its lesson page. Enrolled students see what it is (questions, points, pass mark,
 * attempts left, best score), take it in one form ("Choose all that apply" for multiple choice),
 * and get their result question by question, with the right answers once the API reveals them
 * (passed, or out of attempts), then "Try again" while attempts remain, and their history.
 * Editors and preview viewers see the questions read-only, with a note.
 */
export default function QuizPanel({ school, course, courseSlug, lesson, editHref }) {
  const queryClient = useQueryClient();
  const slug = school.slug;
  const key = keys.quiz(slug, courseSlug, lesson.id);
  const quiz = useQuery({ queryKey: key, queryFn: ({ signal }) => getQuiz(slug, courseSlug, lesson.id, signal), staleTime: 30_000 });
  const [mode, setMode] = useState('summary');
  const [answers, setAnswers] = useState({});
  const [result, setResult] = useState(null);
  const [review, setReview] = useState(null);
  const heading = useRef(null);
  const start = useRef(null);
  const focusNext = useRef(null);
  const enrolled = Boolean(lesson.progressDetail);

  // After each step, focus goes to the new view's heading (or back to the summary's button).
  useEffect(() => {
    const target = focusNext.current;
    focusNext.current = null;
    if (target === 'heading') heading.current?.focus();
    if (target === 'start') (start.current ?? heading.current)?.focus();
  }, [mode]);

  const go = (next, focus) => {
    focusNext.current = focus;
    setMode(next);
  };

  const attempt = useMutation({
    mutationFn: () => attemptQuiz(slug, courseSlug, lesson.id, attemptInput(quiz.data.questions, answers)),
    onSuccess: (outcome) => {
      setResult(outcome);
      setAnswers({});
      go('result', 'heading');
      queryClient.invalidateQueries({ queryKey: key });
      // Passing, or running out of attempts, reveals the answers in earlier attempts too.
      queryClient.invalidateQueries({ queryKey: ['quizAttempt', slug, courseSlug, lesson.id] });
      if (outcome.passed && !lesson.progressDetail?.completed) {
        applyProgress(queryClient, slug, courseSlug, lesson.id, {
          lessonId: lesson.id,
          completed: true,
          completedAt: outcome.createdAt,
          percent: 100,
          positionSeconds: 0,
        });
      }
    },
    onError: (error) => {
      toast(errorMessage(error), { tone: 'error' });
      if (error?.code === 'limit_reached') {
        queryClient.invalidateQueries({ queryKey: key });
        go('summary', 'start');
      }
    },
  });

  if (quiz.isError) return <ErrorState title="Couldn't load this quiz" error={quiz.error} onRetry={() => quiz.refetch()} />;
  if (quiz.isPending)
    return (
      <div className={styles.panel} aria-busy="true">
        <Block width="40%" height="1.4rem" />
        <Block height="4.5rem" radius="var(--radius-md)" />
        <Block width="9rem" height="2.75rem" radius="var(--radius-pill)" />
      </div>
    );

  const q = quiz.data;
  const noQuestions = q.questions.length === 0;
  const attemptNumber = q.attempts.length + 1;

  if (mode === 'taking' && enrolled && !noQuestions)
    return (
      <div className={styles.panel}>
        <QuizForm
          quiz={q}
          answers={answers}
          onChange={setAnswers}
          onHandIn={() => attempt.mutate()}
          onCancel={() => go('summary', 'start')}
          busy={attempt.isPending}
          headingRef={heading}
          attemptNumber={attemptNumber}
        />
      </div>
    );

  const reviewAttempt = (attempt) => {
    setReview(attempt);
    go('review', 'heading');
  };

  if (mode === 'result' && result)
    return (
      <div className={styles.panel}>
        <QuizResult quiz={q} result={result} headingRef={heading} onRetry={() => go('taking', 'heading')} onDone={() => go('summary', 'start')} />
        <History attempts={q.attempts} onReview={reviewAttempt} />
      </div>
    );

  if (mode === 'review' && review)
    return (
      <div className={styles.panel}>
        <PastAttempt
          key={review.id}
          quiz={q}
          attempt={review}
          queryKey={keys.quizAttempt(slug, courseSlug, lesson.id, review.id)}
          load={(signal) => getQuizAttempt(slug, courseSlug, lesson.id, review.id, signal)}
          headingRef={heading}
          onRetry={() => go('taking', 'heading')}
          onDone={() => go('summary', 'start')}
        />
        <History attempts={q.attempts} onReview={reviewAttempt} />
      </div>
    );

  const canTake = enrolled && !noQuestions && (q.attemptsLeft === null || q.attemptsLeft > 0);
  const status = !enrolled ? null : q.passed ? { tone: 'success', label: 'Passed', icon: 'check' } : q.attempts.length ? { tone: 'warning', label: 'Not passed yet' } : null;

  return (
    <div className={styles.panel}>
      <section className={styles.summary} aria-labelledby="quiz-title">
        <div className={styles.summaryHead}>
          <h2 id="quiz-title" ref={heading} tabIndex={-1} className={styles.title}>
            {q.passed && enrolled ? 'Quiz passed' : 'Quiz'}
          </h2>
          {status && (
            <Badge tone={status.tone} icon={status.icon}>
              {status.label}
            </Badge>
          )}
        </div>
        <Facts quiz={q} enrolled={enrolled} />

        {noQuestions ? (
          <p className={styles.note}>
            This quiz doesn't have any questions yet.
            {course?.canEdit && (
              <>
                {' '}
                <Link to={editHref}>Add questions in the course editor</Link>.
              </>
            )}
          </p>
        ) : enrolled ? (
          <div className={styles.actions}>
            {canTake ? (
              <Button ref={start} variant="primary" icon={q.attempts.length ? 'replay' : 'play'} onClick={() => go('taking', 'heading')}>
                {q.attempts.length ? 'Try again' : 'Start quiz'}
              </Button>
            ) : (
              <p className={styles.muted}>You've used all your attempts at this quiz.</p>
            )}
            {canTake && Object.keys(answers).length > 0 && <span className={styles.muted}>Your answers so far are kept.</span>}
          </div>
        ) : null}
      </section>

      {enrolled && <History attempts={q.attempts} onReview={reviewAttempt} />}

      {!enrolled && !noQuestions && (
        <section className={styles.preview} aria-labelledby="preview-title">
          <h3 id="preview-title" className={styles.subTitle}>
            Questions
          </h3>
          <p className={styles.note}>
            <Icon name="eye" size={18} />
            <span>
              {course?.canEdit
                ? 'This is how students see the questions, without the answers. Only enrolled students can take the quiz.'
                : 'Enroll in the course to take this quiz. Here are its questions.'}
            </span>
          </p>
          <ReadOnlyQuestions quiz={q} />
        </section>
      )}
    </div>
  );
}
