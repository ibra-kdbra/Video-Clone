import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import { kindOf, lessonPath, lessonsOf } from '../lib/courses.js';
import { formatDuration, formatRuntime, joinMeta, plural } from '../lib/format.js';
import { lessonNumbers } from '../lib/outline.js';
import Badge from './Badge.jsx';
import Icon from './Icon.jsx';
import styles from './CourseOutline.module.scss';

/** What only the course's editors need to know about a lesson: unpublished, no video, still processing. */
function EditorBadges({ lesson }) {
  const video = lesson.video;
  return (
    <>
      {lesson.status === 'draft' && <Badge tone="warning">Draft</Badge>}
      {!video && lesson.kind === 'lesson' && <Badge>No video</Badge>}
      {video?.provider === 'upload' && (video.status === 'uploading' || video.status === 'processing') && (
        <Badge tone="info" icon="refresh">
          {video.status === 'uploading' ? 'Uploading' : `Processing ${video.progress}%`}
        </Badge>
      )}
      {video?.provider === 'upload' && video.status === 'failed' && (
        <Badge tone="danger" icon="alert">
          Video failed
        </Badge>
      )}
    </>
  );
}

/**
 * Lessons completed while the outline is on screen: their check pops in (once), so finishing one
 * is noticed. Lessons already done when it first showed don't.
 */
function useNewlyCompleted(course) {
  const [fresh, setFresh] = useState(() => new Set());
  const known = useRef(null);
  useEffect(() => {
    const now = new Map(lessonsOf(course).map((lesson) => [lesson.id, Boolean(lesson.progress?.completed)]));
    const before = known.current;
    known.current = now;
    if (!before) return;
    const done = [...now].filter(([id, completed]) => completed && before.get(id) === false).map(([id]) => id);
    if (done.length) setFresh((current) => new Set([...current, ...done]));
  }, [course]);
  return fresh;
}

/**
 * A course's modules and lessons, each lesson a link to its page with its number, length (or its
 * kind, for quizzes and assignments) and state: a lock while it can't be opened yet (not
 * enrolled), "Free preview", a check once completed, and how far into its video this person got
 * (all from the server, for enrolled students). Editors also see drafts and videos still being
 * processed. `currentId` marks the lesson open now (the sidebar of the lesson page, `compact`),
 * which is scrolled into view within the list.
 */
export default function CourseOutline({ course, schoolSlug, currentId, compact = false, headingLevel = 3 }) {
  const numbers = lessonNumbers(course.modules);
  const list = useRef(null);
  const fresh = useNewlyCompleted(course);
  const ModuleTitle = `h${headingLevel}`;

  useEffect(() => {
    // Within its own scrolling box only: the page itself mustn't jump.
    const box = list.current?.closest('[data-outline-scroll]');
    const current = list.current?.querySelector('[aria-current="page"]');
    if (!box || !current) return;
    const top = current.offsetTop - box.offsetTop;
    if (top < box.scrollTop || top > box.scrollTop + box.clientHeight - current.offsetHeight) box.scrollTop = Math.max(0, top - box.clientHeight / 3);
  }, [currentId]);

  return (
    <ol ref={list} className={`${styles.outline} ${compact ? styles.compact : ''}`}>
      {course.modules.map((module, moduleIndex) => {
        const runtime = formatRuntime(module.lessons.reduce((sum, lesson) => sum + (lesson.durationSeconds ?? 0), 0));
        return (
          <li key={module.id} className={styles.module}>
            <div className={styles.moduleHead}>
              <ModuleTitle className={styles.moduleTitle}>
                <span className={styles.moduleIndex}>Module {moduleIndex + 1}</span>
                <span className={styles.moduleName}>{module.title}</span>
              </ModuleTitle>
              <p className={`${styles.moduleMeta} tabular`}>{joinMeta(plural(module.lessons.length, 'lesson'), runtime)}</p>
            </div>
            {module.lessons.length === 0 ? (
              <p className={styles.empty}>No lessons in this module yet.</p>
            ) : (
              <ol className={styles.lessons}>
                {module.lessons.map((lesson) => {
                  const current = lesson.id === currentId;
                  const watched = Boolean(lesson.progress?.completed);
                  const share = (lesson.progress?.percent ?? 0) / 100;
                  const kind = lesson.kind !== 'lesson' && kindOf(lesson);
                  const duration = kind ? '' : formatDuration(lesson.durationSeconds);
                  return (
                    <li key={lesson.id}>
                      <Link
                        to={lessonPath(schoolSlug, course.slug, lesson.id)}
                        className={styles.lesson}
                        aria-current={current ? 'page' : undefined}
                        data-locked={lesson.locked || undefined}
                      >
                        <span
                          className={styles.marker}
                          data-state={current ? 'current' : watched ? 'watched' : lesson.locked ? 'locked' : undefined}
                          data-fresh={(watched && fresh.has(lesson.id)) || undefined}
                        >
                          {current ? (
                            <Icon name="play" size={14} />
                          ) : watched ? (
                            <Icon name="check" size={16} />
                          ) : lesson.locked ? (
                            <Icon name="lock" size={15} />
                          ) : (
                            <span className="tabular">{numbers.get(lesson.id)}</span>
                          )}
                        </span>
                        <span className={styles.text}>
                          <span className={styles.lessonTitle}>
                            <span className="visually-hidden">Lesson {numbers.get(lesson.id)}: </span>
                            {lesson.title}
                            {lesson.locked && <span className="visually-hidden"> (locked: enroll to open it)</span>}
                            {watched && <span className="visually-hidden"> (completed)</span>}
                            {share > 0 && !watched && <span className="visually-hidden"> ({Math.round(share * 100)}% watched)</span>}
                          </span>
                          {!compact && lesson.summary && <span className={styles.summary}>{lesson.summary}</span>}
                          {(lesson.isPreview || course.canEdit) && (
                            <span className={styles.badges}>
                              {lesson.isPreview && <Badge tone="teal">Free preview</Badge>}
                              {course.canEdit && <EditorBadges lesson={lesson} />}
                            </span>
                          )}
                        </span>
                        {kind && (
                          <span className={styles.kind}>
                            <Icon name={kind.icon} size={16} />
                            <span className={compact ? 'visually-hidden' : undefined}>{kind.label}</span>
                          </span>
                        )}
                        {duration && (
                          <span className={`${styles.duration} tabular`}>
                            <span className="visually-hidden">Length </span>
                            {duration}
                          </span>
                        )}
                        {share > 0 && !watched && <span className={styles.watched} style={{ '--share': share }} aria-hidden="true" />}
                      </Link>
                    </li>
                  );
                })}
              </ol>
            )}
          </li>
        );
      })}
    </ol>
  );
}
