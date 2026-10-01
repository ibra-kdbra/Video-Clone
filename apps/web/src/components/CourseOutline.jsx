import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';

import { lessonPath } from '../lib/courses.js';
import { formatDuration, formatRuntime, joinMeta, plural } from '../lib/format.js';
import { lessonNumbers } from '../lib/outline.js';
import { isWatched, useProgress, watchedShare } from '../lib/progress.js';
import Badge from './Badge.jsx';
import Icon from './Icon.jsx';
import styles from './CourseOutline.module.scss';

/** What only the course's editors need to know about a lesson: unpublished, no video, still processing. */
function EditorBadges({ lesson }) {
  const video = lesson.video;
  return (
    <>
      {lesson.status === 'draft' && <Badge tone="warning">Draft</Badge>}
      {!video && <Badge>No video</Badge>}
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
 * A course's modules and lessons, each lesson a link to its page with its number, length and
 * state: a lock while it can't be watched yet (not enrolled), "Free preview", a check once
 * watched, and how far into it this person got. Editors also see drafts and videos still being
 * processed. `currentId` marks the lesson being watched (the sidebar of the lesson page, `compact`),
 * which is scrolled into view within the list.
 */
export default function CourseOutline({ course, schoolSlug, currentId, compact = false, headingLevel = 3 }) {
  const progress = useProgress();
  const numbers = lessonNumbers(course.modules);
  const list = useRef(null);
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
                  const entry = progress.lessons[lesson.id];
                  const watched = isWatched(entry);
                  const share = watchedShare(entry);
                  const duration = formatDuration(lesson.durationSeconds);
                  return (
                    <li key={lesson.id}>
                      <Link
                        to={lessonPath(schoolSlug, course.slug, lesson.id)}
                        className={styles.lesson}
                        aria-current={current ? 'page' : undefined}
                        data-locked={lesson.locked || undefined}
                      >
                        <span className={styles.marker} data-state={current ? 'current' : watched ? 'watched' : lesson.locked ? 'locked' : undefined}>
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
                            {lesson.locked && <span className="visually-hidden"> (locked: enroll to watch)</span>}
                            {watched && <span className="visually-hidden"> (watched)</span>}
                          </span>
                          {!compact && lesson.summary && <span className={styles.summary}>{lesson.summary}</span>}
                          {(lesson.isPreview || course.canEdit) && (
                            <span className={styles.badges}>
                              {lesson.isPreview && <Badge tone="teal">Free preview</Badge>}
                              {course.canEdit && <EditorBadges lesson={lesson} />}
                            </span>
                          )}
                        </span>
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
