/**
 * What the worker writes for Phase 3's notifications (apps/worker/src/notifications): the text
 * and the in-app address, for new threads and comments, replies, reports, and live classes
 * scheduled, about to start and started. The seed (seedSocial.js) and the mock's worker (core.js)
 * both write them from here, so they read the same as the real ones.
 */

/** A post's Markdown down to its words: a notification shows plain text (the worker's plainText). */
export const plainText = (markdown) =>
  String(markdown ?? '')
    .replace(/^\s*(```|~~~)[^\n]*$/gm, ' ') // code fences (the code stays)
    .replace(/^\s{0,3}(#{1,6}|>+|[-*+]|\d+[.)])\s+/gm, '') // headings, quotes, list markers
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1') // images: their alt text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // links: their text
    .replace(/(\*\*|__)(?=\S)(.+?)(?<=\S)\1/g, '$2') // bold
    .replace(/(^|[^\w*])([*_])(?=\S)(.+?)(?<=\S)\2(?![\w*])/g, '$1$3') // italics, not snake_case or 2*3
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/`([^`]+)`/g, '$1');

/** The start of a post, as plain text on one line, for a notification's body (the worker's excerpt). */
export const excerpt = (text, max = 140) => {
  const line = plainText(text).replace(/\s+/g, ' ').trim();
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
};

const REPORT_REASONS = { spam: 'spam', abuse: 'abusive or harmful', off_topic: 'off topic', other: 'something else' };

const WHEN = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });

/** A class's time in notifications. People are in different time zones, so it's in UTC; the app shows local time. */
export const formatWhen = (ms) => `${WHEN.format(new Date(ms))} UTC`;

export const paths = {
  thread: (school, course, lessonId, threadId) => (lessonId ? `/s/${school}/c/${course}/l/${lessonId}?comment=${threadId}` : `/s/${school}/c/${course}/discussions/${threadId}`),
  reports: (school, course) => `/s/${school}/c/${course}/discussions/reports`,
  live: (school, course, sessionId) => `/s/${school}/c/${course}/live/${sessionId}`,
};

/** A new course thread or lesson comment, for the course's staff. */
export const posted = ({ school, course, post, lesson, authorName }) => ({
  title: lesson ? `${authorName} commented on ${lesson.title}` : `${authorName} started a thread: ${post.title}`,
  body: excerpt(post.body),
  path: paths.thread(school, course.slug, post.lessonId, post.id),
});

/** A reply, for the author of the thread or comment it answers. */
export const replied = ({ school, course, parent, reply, lesson, authorName }) => ({
  title: lesson ? `${authorName} replied to your comment on ${lesson.title}` : `${authorName} replied in “${parent.title}”`,
  body: excerpt(reply.body),
  path: paths.thread(school, course.slug, parent.lessonId, parent.id),
});

/** A report, for the course's staff, to look at the moderation queue. */
export const reported = ({ school, course, report }) => ({
  title: `A post was reported in ${course.title}`,
  body: `Reason: ${REPORT_REASONS[report.reason] ?? report.reason}. Have a look in the moderation queue.`,
  path: paths.reports(school, course.slug),
});

export const liveScheduled = ({ school, course, session }) => ({
  title: `Live class: ${session.title}`,
  body: `${course.title} · ${formatWhen(session.startsAt)}`,
  path: paths.live(school, course.slug, session.id),
});

/** Shortly before a class, for its students and its host: `minutes` until it starts. */
export const liveReminder = ({ school, course, session, minutes }) => ({
  title: `Starting in ${minutes} minute${minutes === 1 ? '' : 's'}: ${session.title}`,
  body: `${course.title}. The waiting room is open.`,
  path: paths.live(school, course.slug, session.id),
});

export const liveStarted = ({ school, course, session }) => ({
  title: `Live now: ${session.title}`,
  body: `${course.title}. Come in!`,
  path: paths.live(school, course.slug, session.id),
});
