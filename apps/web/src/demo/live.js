import { ROLE_RANK } from '@grand/contracts';

import { canEditCourse, canSeeCourse, iso } from './logic.js';

/**
 * Live classes' rules and views (apps/api/src/live/live-access.ts and live-store.service.ts): who
 * hosts and who may come in, when the room and a meeting link open, and the shapes the API sends.
 * Times are milliseconds, as everywhere in the mock.
 */

export const MINUTE = 60_000;
/** Students can come into the waiting room this long before the start. */
export const WAITING_ROOM_MS = 15 * MINUTE;
/** A meeting link shows this long before the start. */
export const LINK_EARLY_MS = 10 * MINUTE;
/** The reminder goes out this long before the start. */
export const REMINDER_MS = 15 * MINUTE;
/** A start time can't be in the past (a minute's grace for slow forms). */
export const PAST_GRACE_MS = 60_000;
/** Chat: at most this many messages per person per window. */
export const CHAT_LIMIT = 8;
export const CHAT_WINDOW_MS = 10_000;
/** The providers the demo offers: no LiveKit server here. */
export const DEMO_PROVIDERS = ['youtube', 'link'];

export const endsAt = (session) => session.startsAt + session.durationMinutes * MINUTE;

/** Whether someone may be in the class's room now (hosts always may, until it's over). */
export function roomOpen(session, host, now) {
  if (session.status === 'live') return true;
  if (session.status !== 'scheduled') return false;
  return host || session.startsAt - now <= WAITING_ROOM_MS;
}

/** Hosts are the course's editors: admins and the owner, and the instructor who wrote it. */
export const isHost = (role, userId, course) => role !== null && role !== undefined && (ROLE_RANK[role] >= ROLE_RANK.admin || (role === 'instructor' && course.createdBy === userId));

/** How this person relates to a course's classes: host (an editor), enrolled, and whether they may come in. */
export function viewingOf(db, school, userId, course) {
  const host = canEditCourse(school, userId, course);
  const enrolled = Boolean(db.get('enrollments', `${course.id}:${userId}`));
  return { school, userId, course, host, enrolled, canJoin: host || (enrolled && course.status === 'published') };
}

/**
 * For the live connection, which knows a class's id but not its school: the class and how this
 * person relates to it, or null when any of it is missing or out of reach.
 */
export function sessionById(db, userId, sessionId) {
  const session = db.get('liveSessions', sessionId);
  const course = session && db.get('courses', session.courseId);
  const school = course && db.get('schools', course.schoolId);
  const membership = school && db.get('memberships', `${school.id}:${userId}`);
  if (!membership) return null;
  const context = { id: school.id, slug: school.slug, name: school.name, role: membership.role };
  if (!canSeeCourse(context, userId, course)) return null;
  return { session, viewing: viewingOf(db, context, userId, course) };
}

/** As sessionById, for a course: whether this person may follow its discussions. */
export function courseById(db, userId, courseId) {
  const course = db.get('courses', courseId);
  const school = course && db.get('schools', course.schoolId);
  const membership = school && db.get('memberships', `${school.id}:${userId}`);
  if (!membership) return null;
  const context = { id: school.id, slug: school.slug, name: school.name, role: membership.role };
  if (!canSeeCourse(context, userId, course)) return null;
  return viewingOf(db, context, userId, course);
}

/** Everything the class's page shows about it, for this viewer. */
export function toSession(db, session, viewing, now) {
  // The stream's reference only for those who may join; a meeting link only once it's nearly time.
  let streamRef = viewing.canJoin ? session.streamRef : null;
  if (streamRef && session.provider === 'link' && !viewing.host) {
    const soon = session.status === 'live' || (session.status === 'scheduled' && session.startsAt - now <= LINK_EARLY_MS);
    if (!soon) streamRef = null;
  }
  const host = session.createdBy ? db.get('users', session.createdBy) : null;
  return {
    id: session.id,
    courseId: viewing.course.id,
    courseSlug: viewing.course.slug,
    courseTitle: viewing.course.title,
    title: session.title,
    description: session.description,
    startsAt: iso(session.startsAt),
    endsAt: iso(endsAt(session)),
    durationMinutes: session.durationMinutes,
    status: session.status,
    provider: session.provider,
    streamRef,
    recordingRef: viewing.canJoin ? session.recordingRef : null,
    startedAt: iso(session.startedAt),
    endedAt: iso(session.endedAt),
    host: host ? { id: host.id, name: host.name } : null,
    canHost: viewing.host,
    canJoin: viewing.canJoin,
    attendeeCount: db.count('liveAttendance', (row) => row.sessionId === session.id),
  };
}

/** Names, and whether each person hosts this course's classes. */
export function personIn(db, course, userId) {
  const user = db.get('users', userId);
  if (!user) return null;
  const membership = db.get('memberships', `${course.schoolId}:${userId}`);
  return { name: user.name, host: isHost(membership?.role ?? null, userId, course) };
}

/** A chat message as this viewer sees it: a hidden one's text only for the class's hosts. */
export function toMessage(db, message, course, viewerIsHost) {
  const hidden = message.hiddenAt !== null;
  const author = message.userId ? personIn(db, course, message.userId) : null;
  return {
    id: message.id,
    sessionId: message.sessionId,
    author: message.userId && author ? { id: message.userId, name: author.name, host: author.host } : null,
    body: hidden && !viewerIsHost ? '' : message.body,
    hidden,
    createdAt: iso(message.createdAt),
  };
}

const byTime = (a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * The latest messages before `before` (a message's id), oldest first: older in the list's own
 * (time, id) order, so messages sharing the anchor's timestamp aren't skipped. Null when `before`
 * isn't one of this class's.
 */
export function latestMessages(db, sessionId, { before, limit }) {
  let anchor = null;
  if (before) {
    anchor = db.get('liveMessages', before);
    if (!anchor || anchor.sessionId !== sessionId) return null;
  }
  return db
    .filter('liveMessages', (row) => row.sessionId === sessionId && (anchor === null || byTime(row, anchor) < 0))
    .sort(byTime)
    .slice(-limit);
}

export const statusEvent = (session) => ({ sessionId: session.id, status: session.status, startedAt: iso(session.startedAt), endedAt: iso(session.endedAt) });

/** Records that someone is in the class: first joined, and last seen now. */
export function recordAttendance(db, session, userId, now) {
  const id = `${session.id}:${userId}`;
  const row = db.get('liveAttendance', id);
  if (row) return db.update('liveAttendance', id, { lastSeenAt: now });
  return db.put('liveAttendance', { id, schoolId: session.schoolId, sessionId: session.id, userId, joinedAt: now, lastSeenAt: now });
}
