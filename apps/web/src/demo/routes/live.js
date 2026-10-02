import { courseSlug, createLiveSessionInput, liveMessagesQuery, liveScheduleQuery, liveSpeakerInput, normalizeStreamRef, updateLiveSessionInput, uuid } from '@grand/contracts';

import { HttpError, conflict, forbidden, notFound } from '../http.js';
import { randomId } from '../ids.js';
import { DEMO_PROVIDERS, PAST_GRACE_MS, latestMessages, statusEvent, toMessage, toSession, viewingOf } from '../live.js';
import { enrollmentRequired, findVisible } from './shared.js';

/**
 * Live classes (apps/api/src/live): scheduling by the course's editors, starting, ending and
 * cancelling, the chat's history and moderation, attendance, and who may speak. The demo has no
 * LiveKit server, so it offers YouTube Live and meeting links, and answers for LiveKit as the API
 * does when it isn't configured. The room itself (presence, chat, hands, and the scripted
 * classmates) is in ../liveRooms.js, reached through `server.live`.
 */

const invalid = (path, message) => new HttpError(400, 'validation_failed', message, [{ path, message }]);
const isOver = () => conflict('This class is over.');
const browserVideoOff = () => new HttpError(503, 'service_unavailable', "Live video in the browser isn't available right now.");

const course = { courseSlug };
const session = { courseSlug, sessionId: uuid };
const C = '/schools/:slug/courses/:courseSlug/live';

/** Upcoming: scheduled or live, and cancelled ones not yet past. Past: ended. */
const inWhen = (when, now) => (row) => (when === 'upcoming' ? row.status === 'scheduled' || row.status === 'live' || (row.status === 'cancelled' && row.startsAt > now) : row.status === 'ended');
const order = (when) => (when === 'upcoming' ? (a, b) => a.startsAt - b.startsAt : (a, b) => b.startsAt - a.startsAt);

/** Checks a new stream reference against the class's provider. */
function parseStreamRef(provider, value) {
  const issues = [];
  const ref = normalizeStreamRef(provider, value, { addIssue: (issue) => issues.push(issue) });
  if (issues.length) throw invalid('streamRef', issues[0].message ?? 'Check the address');
  return ref;
}

export function register(router, server) {
  const viewCourse = (ctx) => viewingOf(ctx.db, ctx.school, ctx.auth.userId, findVisible(ctx, ctx.params.courseSlug));

  /** The course, if this person hosts its classes. */
  const hosting = (ctx) => {
    const viewing = viewCourse(ctx);
    if (!viewing.host) throw forbidden("Only the course's editors run its classes.");
    return viewing;
  };

  /** The course, if this person may come into its classes. */
  const joining = (ctx) => {
    const viewing = viewCourse(ctx);
    if (!viewing.canJoin) throw enrollmentRequired('Enroll in this course to join its live classes.');
    return viewing;
  };

  const sessionOf = (ctx, viewing) => {
    const row = ctx.db.get('liveSessions', ctx.params.sessionId);
    if (!row || row.courseId !== viewing.course.id) throw notFound('This class');
    return row;
  };

  const describe = (ctx, viewing, row) => toSession(ctx.db, row, viewing, ctx.now);

  // The schedule ------------------------------------------------------------------------------------

  router.add('GET', '/schools/:slug/live/options', { school: 'student' }, () => ({ providers: [...DEMO_PROVIDERS] }));

  router.add('GET', '/schools/:slug/live', { school: 'student', query: liveScheduleQuery }, (ctx) => {
    const { db, school, auth, query } = ctx;
    return db
      .filter('liveSessions', (row) => row.schoolId === school.id)
      .filter(inWhen(query.when, ctx.now))
      .sort(order(query.when))
      .slice(0, 200)
      .map((row) => ({ row, viewing: viewingOf(db, school, auth.userId, db.get('courses', row.courseId)) }))
      .filter(({ viewing }) => viewing.canJoin)
      .slice(0, query.limit)
      .map(({ row, viewing }) => describe(ctx, viewing, row));
  });

  router.add('GET', C, { school: 'student', params: course, query: liveScheduleQuery }, (ctx) => {
    const viewing = viewCourse(ctx);
    return ctx.db
      .filter('liveSessions', (row) => row.courseId === viewing.course.id)
      .filter(inWhen(ctx.query.when, ctx.now))
      .sort(order(ctx.query.when))
      .slice(0, ctx.query.limit)
      .map((row) => describe(ctx, viewing, row));
  });

  // Scheduling and running a class ------------------------------------------------------------------

  router.add('POST', C, { school: 'instructor', params: course, body: createLiveSessionInput }, (ctx) => {
    const { body: input } = ctx;
    if (!DEMO_PROVIDERS.includes(input.provider)) throw invalid('provider', "Live video in the browser isn't set up on this server. Use YouTube Live or a meeting link.");
    const startsAt = Date.parse(input.startsAt);
    if (startsAt < ctx.now - PAST_GRACE_MS) throw invalid('startsAt', 'Choose a time in the future');
    const viewing = hosting(ctx);
    const created = ctx.db.put('liveSessions', {
      id: randomId(),
      key: null,
      schoolId: viewing.course.schoolId,
      courseId: viewing.course.id,
      title: input.title,
      description: input.description,
      startsAt,
      durationMinutes: input.durationMinutes,
      status: 'scheduled',
      provider: input.provider,
      streamRef: input.streamRef,
      recordingRef: null,
      startedAt: null,
      endedAt: null,
      createdBy: ctx.auth.userId,
      createdAt: ctx.now,
    });
    server.live.scheduled({ course: viewing.course, session: created, actorId: ctx.auth.userId });
    return describe(ctx, viewing, created);
  });

  router.add('GET', `${C}/:sessionId`, { school: 'student', params: session }, (ctx) => {
    const viewing = viewCourse(ctx);
    return describe(ctx, viewing, sessionOf(ctx, viewing));
  });

  /** Before it starts, anything; while it's on, its text, length and stream; once it's over, its text and recording. */
  router.add('PATCH', `${C}/:sessionId`, { school: 'instructor', params: session, body: updateLiveSessionInput }, (ctx) => {
    const { body: input } = ctx;
    const viewing = hosting(ctx);
    const current = sessionOf(ctx, viewing);
    if (current.status === 'cancelled') throw conflict('This class was cancelled.');
    const changes = {};
    if (input.title !== undefined) changes.title = input.title;
    if (input.description !== undefined) changes.description = input.description;
    if (input.startsAt !== undefined) {
      if (current.status !== 'scheduled') throw conflict('A class that has started keeps its start time.');
      const startsAt = Date.parse(input.startsAt);
      if (startsAt < ctx.now - PAST_GRACE_MS) throw invalid('startsAt', 'Choose a time in the future');
      changes.startsAt = startsAt;
    }
    if (input.durationMinutes !== undefined) {
      if (current.status === 'ended') throw isOver();
      changes.durationMinutes = input.durationMinutes;
    }
    if (input.streamRef !== undefined) {
      if (current.status === 'ended') throw conflict('This class is over: add a recording instead.');
      changes.streamRef = parseStreamRef(current.provider, input.streamRef);
    }
    if (input.recordingRef !== undefined) {
      if (current.status !== 'ended') throw conflict('A recording can be added once the class is over.');
      changes.recordingRef = input.recordingRef;
    }
    server.live.adopt(current);
    const updated = ctx.db.update('liveSessions', current.id, changes);
    // A new time gets a new reminder.
    if (changes.startsAt !== undefined) server.live.rescheduled(updated);
    server.emitToLive(current.id, 'live:status', statusEvent(updated));
    return describe(ctx, viewing, updated);
  });

  router.add('POST', `${C}/:sessionId/start`, { school: 'instructor', params: session, status: 200 }, (ctx) => {
    const viewing = hosting(ctx);
    const current = sessionOf(ctx, viewing);
    if (current.status === 'live') return describe(ctx, viewing, current);
    if (current.status !== 'scheduled') throw current.status === 'cancelled' ? conflict('This class was cancelled.') : isOver();
    if (current.provider === 'youtube' && !current.streamRef) throw conflict('Add the YouTube stream before going live.');
    if (current.provider === 'livekit') throw browserVideoOff();
    server.live.adopt(current);
    const started = server.live.start(current, { actorId: ctx.auth.userId, course: viewing.course });
    return describe(ctx, viewing, started);
  });

  router.add('POST', `${C}/:sessionId/end`, { school: 'instructor', params: session, status: 200 }, (ctx) => {
    const viewing = hosting(ctx);
    const current = sessionOf(ctx, viewing);
    if (current.status === 'ended') return describe(ctx, viewing, current);
    if (current.status !== 'live') throw conflict(current.status === 'cancelled' ? 'This class was cancelled.' : "This class hasn't started.");
    server.live.adopt(current);
    const ended = ctx.db.update('liveSessions', current.id, { status: 'ended', endedAt: ctx.now });
    server.emitToLive(current.id, 'live:status', statusEvent(ended));
    server.live.closed(ended);
    return describe(ctx, viewing, ended);
  });

  router.add('POST', `${C}/:sessionId/cancel`, { school: 'instructor', params: session, status: 200 }, (ctx) => {
    const viewing = hosting(ctx);
    const current = sessionOf(ctx, viewing);
    if (current.status === 'cancelled') return describe(ctx, viewing, current);
    if (current.status !== 'scheduled') throw conflict('A class that has started can only be ended.');
    server.live.adopt(current);
    const cancelled = ctx.db.update('liveSessions', current.id, { status: 'cancelled' });
    server.emitToLive(current.id, 'live:status', statusEvent(cancelled));
    server.live.closed(cancelled);
    return describe(ctx, viewing, cancelled);
  });

  /** Removes a class that never happened. One that started stays on record. */
  router.add('DELETE', `${C}/:sessionId`, { school: 'instructor', params: session }, (ctx) => {
    const viewing = hosting(ctx);
    const current = sessionOf(ctx, viewing);
    if (current.status !== 'scheduled' && current.status !== 'cancelled') throw conflict('A class that has started stays on record; end it instead.');
    server.live.closed(current);
    server.live.removed(current);
    removeSessions(ctx.db, [current.id]);
  });

  // The chat and who came ---------------------------------------------------------------------------

  router.add('GET', `${C}/:sessionId/messages`, { school: 'student', params: session, query: liveMessagesQuery }, (ctx) => {
    const viewing = joining(ctx);
    sessionOf(ctx, viewing);
    const rows = latestMessages(ctx.db, ctx.params.sessionId, ctx.query);
    if (!rows) throw notFound('This message');
    return rows.map((row) => toMessage(ctx.db, row, viewing.course, viewing.host));
  });

  router.add('POST', `${C}/:sessionId/messages/:messageId/hide`, { school: 'instructor', params: { ...session, messageId: uuid }, status: 204 }, (ctx) => {
    const viewing = hosting(ctx);
    sessionOf(ctx, viewing);
    const message = ctx.db.get('liveMessages', ctx.params.messageId);
    if (!message || message.sessionId !== ctx.params.sessionId) throw notFound('This message');
    if (message.hiddenAt !== null) return;
    ctx.db.update('liveMessages', message.id, { hiddenAt: ctx.now, hiddenBy: ctx.auth.userId });
    server.emitToLive(message.sessionId, 'live:message-hidden', { sessionId: message.sessionId, messageId: message.id });
  });

  router.add('GET', `${C}/:sessionId/attendance`, { school: 'instructor', params: session }, (ctx) => {
    const viewing = hosting(ctx);
    sessionOf(ctx, viewing);
    return ctx.db
      .filter('liveAttendance', (row) => row.sessionId === ctx.params.sessionId)
      .sort((a, b) => a.joinedAt - b.joinedAt)
      .flatMap((row) => {
        const user = ctx.db.get('users', row.userId);
        return user ? [{ userId: row.userId, name: user.name, joinedAt: new Date(row.joinedAt).toISOString(), lastSeenAt: new Date(row.lastSeenAt).toISOString() }] : [];
      });
  });

  // The video ---------------------------------------------------------------------------------------

  /** A LiveKit token: there's no LiveKit server in the demo, so only the API's refusals. */
  router.add('POST', `${C}/:sessionId/token`, { school: 'student', params: session, status: 200 }, (ctx) => {
    const viewing = joining(ctx);
    const current = sessionOf(ctx, viewing);
    if (current.provider !== 'livekit') throw conflict("This class's video isn't in the browser.");
    throw browserVideoOff();
  });

  /**
   * Lets a student speak, or stops them: LiveKit classes only, so never in the demo, which has no
   * LiveKit (a raised hand is answered in the chat instead).
   */
  router.add('POST', `${C}/:sessionId/speakers/:userId`, { school: 'instructor', params: { ...session, userId: uuid }, body: liveSpeakerInput, status: 204 }, (ctx) => {
    const viewing = hosting(ctx);
    const current = sessionOf(ctx, viewing);
    if (current.status !== 'live') throw conflict(current.status === 'scheduled' ? "The class hasn't started yet." : 'This class is over.');
    if (current.provider !== 'livekit') throw conflict('Students can speak only in LiveKit classes.');
    // A LiveKit class can't be scheduled in the demo, so this is as far as it goes.
    throw browserVideoOff();
  });
}

/** Removes classes with their chat, attendance and pending reminders (the database's cascades). */
export function removeSessions(db, sessionIds) {
  const ids = new Set(sessionIds);
  db.removeWhere('liveMessages', (row) => ids.has(row.sessionId));
  db.removeWhere('liveAttendance', (row) => ids.has(row.sessionId));
  db.removeWhere('jobs', (row) => ids.has(row.payload?.sessionId));
  for (const id of ids) db.remove('liveSessions', id);
}
