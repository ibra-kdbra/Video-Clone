import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { formatPoints } from '../lib/assignments.js';
import { LESSON_KINDS, keys } from '../lib/courses.js';
import { plural } from '../lib/format.js';
import { retentionSeries } from '../lib/insights.js';
import { getCourseInsights, getLessonInsights } from '../lib/learning.js';
import Icon from './Icon.jsx';
import ProgressBar from './ProgressBar.jsx';
import RetentionChart from './RetentionChart.jsx';
import { Block } from './Skeleton.jsx';
import { EmptyState, ErrorState } from './States.jsx';
import styles from './CourseInsights.module.scss';

/** One headline number. */
function Tile({ label, value, detail }) {
  return (
    <div className={styles.tile}>
      <dt className={styles.tileLabel}>{label}</dt>
      <dd className={styles.tileValue}>{value}</dd>
      {detail && <dd className={styles.tileDetail}>{detail}</dd>}
    </div>
  );
}

/** What else there is to know about a lesson, by kind: how much is watched, passed or graded. */
function kindDetail(lesson) {
  if (lesson.quiz) {
    if (lesson.quiz.students === 0) return 'No attempts yet';
    return `${lesson.quiz.passRate}% passed · best ${lesson.quiz.averageBestPercent}% on average`;
  }
  if (lesson.assignment) {
    const { submitted, graded, averageGrade, maxPoints } = lesson.assignment;
    if (submitted === 0) return 'Nothing handed in yet';
    return [`${submitted} handed in`, `${graded} graded`, averageGrade !== null && `average ${formatPoints(averageGrade)}/${maxPoints}`].filter(Boolean).join(' · ');
  }
  if (lesson.averageWatchedPercent !== null) return `${lesson.averageWatchedPercent}% watched on average`;
  return 'No uploaded video';
}

/** Lessons with more to show: an uploaded video's retention, a quiz's questions. */
const hasDetail = (lesson) => lesson.kind === 'quiz' || lesson.averageWatchedPercent !== null;

/** How often each question of a quiz is answered correctly, as bars. */
function QuestionBars({ questions }) {
  if (!questions?.length) return <p className={styles.muted}>This quiz has no questions yet.</p>;
  const answered = questions.some((question) => question.answered > 0);
  if (!answered) return <p className={styles.muted}>No one has answered these questions yet.</p>;
  const hardest = questions.reduce((low, question) => (question.answered && question.correctRate < low.correctRate ? question : low), { correctRate: 101 });
  return (
    <div className={styles.bars}>
      {hardest.prompt && (
        <p className={styles.summary}>
          The hardest question is “{hardest.prompt}”: {hardest.correctRate}% answer it correctly.
        </p>
      )}
      <ol className={styles.barList}>
        {questions.map((question, index) => (
          <li key={question.id} className={styles.barItem}>
            <p className={styles.barPrompt}>
              <span className={`${styles.barNumber} tabular`}>{index + 1}</span>
              <span>{question.prompt}</span>
            </p>
            <div className={styles.barRow}>
              <span className={styles.barTrack} aria-hidden="true">
                <span className={styles.barFill} style={{ '--value': question.correctRate / 100 }} />
              </span>
              <span className={`${styles.barValue} tabular`}>
                {question.answered ? `${question.correctRate}% correct` : 'Not answered yet'}
                <span className={styles.barCount}>{question.answered ? ` · ${plural(question.answered, 'answer')}` : ''}</span>
              </span>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** The selected lesson in detail: where viewers stop watching, or how each question goes. */
function LessonDetail({ school, course, lesson, headingRef }) {
  const detail = useQuery({
    queryKey: keys.lessonInsights(school.slug, course.slug, lesson.lessonId),
    queryFn: ({ signal }) => getLessonInsights(school.slug, course.slug, lesson.lessonId, signal),
    staleTime: 60_000,
  });
  const kind = LESSON_KINDS[lesson.kind] ?? LESSON_KINDS.lesson;
  return (
    <section className={styles.detail} aria-labelledby="insight-detail-title">
      <h3 id="insight-detail-title" ref={headingRef} tabIndex={-1} className={styles.detailTitle}>
        <Icon name={kind.icon} size={18} />
        <span>
          {lesson.title}: {lesson.kind === 'quiz' ? 'questions' : 'where viewers stop'}
        </span>
      </h3>
      {detail.isError ? (
        <ErrorState title="Couldn't load this lesson's insights" error={detail.error} onRetry={() => detail.refetch()} titleAs="h4" />
      ) : detail.isPending ? (
        <Block height="14rem" radius="var(--radius-md)" />
      ) : lesson.kind === 'quiz' ? (
        <QuestionBars questions={detail.data.questions} />
      ) : detail.data.retention ? (
        <RetentionChart series={retentionSeries(detail.data.retention)} title={lesson.title} />
      ) : (
        <p className={styles.muted}>There's nothing to show for this lesson yet.</p>
      )}
    </section>
  );
}

/**
 * How a course is going, for its editors (the course editor's Insights tab): who's enrolled and
 * active, how many have completed it and how far students are on average; then every lesson with
 * how many started and completed it, and what else matters for its kind. Picking an uploaded video
 * shows where viewers stop watching; picking a quiz, how each question is answered.
 */
export default function CourseInsights({ school, course }) {
  const insights = useQuery({
    queryKey: keys.insights(school.slug, course.slug),
    queryFn: ({ signal }) => getCourseInsights(school.slug, course.slug, signal),
    staleTime: 60_000,
  });
  const [selected, setSelected] = useState(null);
  const detailHeading = useRef(null);
  const focusDetail = useRef(false);

  useEffect(() => {
    if (!focusDetail.current) return;
    focusDetail.current = false;
    detailHeading.current?.focus();
  }, [selected]);

  if (insights.isError) return <ErrorState title="Couldn't load the insights" error={insights.error} onRetry={() => insights.refetch()} />;
  if (insights.isPending)
    return (
      <div className={styles.insights} aria-busy="true">
        <div className={styles.tiles}>
          {Array.from({ length: 4 }, (_, i) => (
            <Block key={i} height="6rem" radius="var(--radius-lg)" />
          ))}
        </div>
        <Block height="18rem" radius="var(--radius-lg)" />
      </div>
    );

  const data = insights.data;
  const chosen = data.lessons.find((lesson) => lesson.lessonId === selected) ?? null;
  const select = (lessonId) => {
    focusDetail.current = lessonId !== selected;
    setSelected(lessonId === selected ? null : lessonId);
  };

  return (
    <div className={styles.insights}>
      <dl className={styles.tiles}>
        <Tile label="Enrolled" value={data.enrolled.toLocaleString()} detail={data.enrolled === 1 ? 'student' : 'students'} />
        <Tile
          label="Active in the last 7 days"
          value={data.activeLast7Days.toLocaleString()}
          detail={data.enrolled ? `${Math.round((data.activeLast7Days / data.enrolled) * 100)}% of students` : null}
        />
        <Tile
          label="Completed the course"
          value={data.completedCourse.toLocaleString()}
          detail={data.enrolled ? `${Math.round((data.completedCourse / data.enrolled) * 100)}% of students` : null}
        />
        <Tile label="Average progress" value={`${data.averagePercent}%`} detail="of published lessons completed" />
      </dl>

      {data.lessons.length === 0 ? (
        <EmptyState icon="chart" title="No lessons yet" titleAs="h3">
          Once the course has lessons and students, you'll see how each one is going here.
        </EmptyState>
      ) : (
        <section className={styles.lessons} aria-labelledby="insight-lessons-title">
          <div className={styles.lessonsHead}>
            <h3 id="insight-lessons-title" className={styles.sectionTitle}>
              Lessons
            </h3>
            <p className={styles.muted}>Completion is out of every enrolled student. Choose a video or a quiz to see more.</p>
          </div>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Module</th>
                <th scope="col">Lesson</th>
                <th scope="col" className={styles.number}>
                  Started
                </th>
                <th scope="col" className={styles.number}>
                  Completed
                </th>
                <th scope="col">Completion rate</th>
                <th scope="col">Details</th>
              </tr>
            </thead>
            <tbody>
              {data.lessons.map((lesson) => {
                const kind = LESSON_KINDS[lesson.kind] ?? LESSON_KINDS.lesson;
                const isSelected = lesson.lessonId === selected;
                return (
                  <tr key={lesson.lessonId} data-selected={isSelected || undefined}>
                    <td data-label="Module" className={styles.module}>
                      {lesson.moduleTitle}
                    </td>
                    <th scope="row" data-label="Lesson" className={styles.title}>
                      <span className={styles.titleInner}>
                        <Icon name={kind.icon} size={16} label={kind.label} className={styles.kindIcon} />
                        {hasDetail(lesson) ? (
                          <button type="button" className={styles.pick} aria-pressed={isSelected} onClick={() => select(lesson.lessonId)}>
                            {lesson.title}
                          </button>
                        ) : (
                          <span>{lesson.title}</span>
                        )}
                      </span>
                    </th>
                    <td data-label="Started" className={`${styles.number} tabular`}>
                      {lesson.started}
                    </td>
                    <td data-label="Completed" className={`${styles.number} tabular`}>
                      {lesson.completed}
                    </td>
                    <td data-label="Completion rate" className={styles.rate}>
                      <span className={styles.rateInner}>
                        <ProgressBar value={lesson.completionRate} tone={lesson.completionRate >= 100 ? 'success' : 'accent'} />
                        <span className="tabular">{lesson.completionRate}%</span>
                      </span>
                    </td>
                    <td data-label="Details" className={styles.details}>
                      {kindDetail(lesson)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}

      {chosen ? (
        <LessonDetail key={chosen.lessonId} school={school} course={course} lesson={chosen} headingRef={detailHeading} />
      ) : (
        data.lessons.some(hasDetail) && <p className={styles.pickHint}>Choose a video lesson or a quiz above to see where viewers stop, or how each question goes.</p>
      )}
    </div>
  );
}
