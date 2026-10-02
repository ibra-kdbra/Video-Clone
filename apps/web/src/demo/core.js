import { ROLE_RANK, liveHandInput, liveJoinInput, liveMessageInput, notificationSettings, watchCourseInput } from '@grand/contracts';

import { HttpError, createRouter, errorResponse, ok, parse, schoolAccess, unauthenticated } from './http.js';
import { createRandom, hash128, randomId, randomToken } from './ids.js';
import { CHAT_LIMIT, CHAT_WINDOW_MS, REMINDER_MS, courseById, endsAt, latestMessages, recordAttendance, roomOpen, sessionById, statusEvent, toMessage, toSession } from './live.js';
import { createLiveRooms } from './liveRooms.js';
import { canEditCourse, formatPoints } from './logic.js';
import * as notices from './notices.js';
import { register as auth, verifyAccess } from './routes/auth.js';
import { register as courses } from './routes/courses.js';
import { register as discussions } from './routes/discussions.js';
import { register as learning } from './routes/learning.js';
import { register as live, removeSessions } from './routes/live.js';
import { register as notifications, toNotification } from './routes/notifications.js';
import { register as schools } from './routes/schools.js';
import { register as search } from './routes/search.js';
import { coverUrl, markCompleted } from './routes/shared.js';
import { HOUR, MINUTE, buildSeed, ids, roundGrade, sampleFileText } from './seed.js';
import { STORAGE_KEY, browserStorage, createDb, readOverlay } from './store.js';
import { validateContent, validateSocial } from './validate.js';

/**
 * The mock API: answers `/api/v1` requests from the page with real Responses, from the demo
 * school's data (seed plus the visitor's saved changes), following the API's rules. Around the
 * routes it does what the API's other parts do: it notifies people (as the worker would, honoring
 * their settings) and tells the page live (as the WebSocket would, through `subscribe`), and it
 * runs a few things later, so the demo feels alive: an instructor grades work handed in about 20
 * seconds after, and a classmate hands in work while an instructor is looking. With `social`
 * (social.js), it has Phase 3 too: discussions, live classes with a scripted room of classmates
 * (liveRooms.js, reached through `realtime`, the socket's side), and search.
 *
 * `createServer` is the testable core; src/demo/server.js makes the app's one instance.
 */

export const AUTOGRADE_AFTER_MS = 20_000;
export const HANDIN_AFTER_MS = 35_000;
/** Classes left live this long after their planned end are ended, and scheduled ones that never started cancelled (the worker's close_stale_live). */
export const STALE_LIVE_MS = 2 * 60 * MINUTE;

const abortError = () => new DOMException('The operation was aborted.', 'AbortError');

export function createServer({
  content,
  media = {},
  social = null,
  now = () => Date.now(),
  storage = browserStorage(),
  latency = [40, 140],
  userAgent = typeof navigator === 'undefined' ? 'Demo' : navigator.userAgent,
  timers = { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (id) => clearTimeout(id) },
  strict = false,
} = {}) {
  const problems = [...validateContent(content, media), ...(social ? validateSocial(social, content) : [])].filter((problem) => !/can't be scored on this quiz/.test(problem));
  const complain = (found) => {
    if (!found.length) return;
    if (strict) throw new Error(`The demo content has problems:\n${found.join('\n')}`);
    if (import.meta.env.DEV) console.error(`The demo content has problems:\n${found.join('\n')}`);
  };
  complain(problems);

  const contentHash = hash128(JSON.stringify({ content, media, social }));
  const school = { slug: content.SCHOOL.slug, id: ids.school(content.SCHOOL.slug) };
  let seed = null;
  let overlay = null;
  let db = null;
  let effects = [];
  let jobTimer = null;
  const listeners = new Set();
  const handinsFor = new Set();
  const blobs = new Map();
  const blobUrls = new Map();
  const blobNames = new Map();

  /**
   * The seeded live classes come in occurrences, so every visit finds them as the seed has them
   * (one live now, one in 20 minutes...), however long ago the last visit was. An occurrence starts
   * on a page load with no current one, and lasts until its next few hours of classes are over
   * (`meta.live`); reloads within it keep the same classes, times and ids. What happens in it
   * automatically (a class starting or ending on time, the classmates' chat) belongs to it. When a
   * later load starts a new one, the old occurrence's classes are forgotten, with their chat,
   * attendance, jobs and notifications, except those the visitor changed themselves (started,
   * ended, cancelled, edited: `adopted`), which stay as they left them, with their whole chat. A
   * visitor's chat in a class they didn't change goes with its occurrence. Seeded classes the
   * visitor deleted stay deleted.
   */
  function load({ fresh = false } = {}) {
    overlay = readOverlay(storage, contentHash);
    overlay.meta ??= {};
    overlay.meta.secret ??= randomToken();
    const kept = overlay.meta.live;
    const current = kept && Number.isFinite(kept.occurrence) && Number.isFinite(kept.ends) && kept.occurrence <= now() && now() < kept.ends ? kept.occurrence : null;
    const occurrence = current ?? now();
    if (!seed || fresh || seed.occurrence !== Math.floor(occurrence / MINUTE) * MINUTE) seed = buildSeed({ content, media, social, now: now(), occurrence });
    overlay.meta.live = { ...kept, occurrence: seed.occurrence, ends: seed.occurrenceEnds ?? seed.occurrence + HOUR };
    db = createDb(seed.tables, overlay);
    if (kept && current === null) {
      // A new occurrence: forget the old one's, and save that (so other tabs pick it up too).
      forgetOccurrence();
      rooms.reset();
      persist();
    }
  }

  /** What's left of past occurrences after a new one starts (see load). */
  function forgetOccurrence() {
    const fresh = seed.occurrence;
    // Marks for seeded rows that no longer exist (an old occurrence's) mean nothing now.
    for (const [name, rows] of Object.entries(overlay.tables)) {
      for (const [id, row] of Object.entries(rows)) if (row === null && !seed.tables[name]?.has(id)) delete rows[id];
    }
    const suppress = new Set(overlay.meta.live.removed ?? []);
    for (const row of db.filter('liveSessions', (item) => item.key && item.occurrence !== fresh)) {
      if (!row.adopted) {
        db.remove('liveSessions', row.id);
        continue;
      }
      // Changed by the visitor: kept as they left it, closed if its time has passed (as the worker would).
      const over = endsAt(row) <= now();
      if (row.status === 'live' && over) db.update('liveSessions', row.id, { status: 'ended', endedAt: Math.max(row.startedAt ?? row.startsAt, endsAt(row)) });
      else if (row.status === 'scheduled' && over) db.update('liveSessions', row.id, { status: 'cancelled' });
      // Still to come or on: no fresh copy of it alongside.
      else if (row.status === 'scheduled' || row.status === 'live') suppress.add(row.key);
    }
    const copies = db.filter('liveSessions', (item) => item.key && item.occurrence === fresh && suppress.has(item.key)).map((item) => item.id);
    if (copies.length) removeSessions(db, copies);
    // What belonged to the forgotten classes goes with them.
    const exists = (sessionId) => Boolean(db.get('liveSessions', sessionId));
    db.removeWhere('liveMessages', (row) => !exists(row.sessionId));
    db.removeWhere('liveAttendance', (row) => !exists(row.sessionId));
    db.removeWhere('jobs', (row) => row.payload?.sessionId && !exists(row.payload.sessionId));
    db.removeWhere('notifications', (row) => {
      const sessionId = /\/live\/([0-9a-f-]{36})$/.exec(row.data?.path ?? '')?.[1];
      return Boolean(sessionId) && !exists(sessionId);
    });
  }

  function persist() {
    db.clean();
    storage.set(STORAGE_KEY, JSON.stringify(overlay));
  }

  /** Runs the side effects a request (or a job) queued, once its changes are kept. */
  function flush() {
    const queued = effects;
    effects = [];
    for (const effect of queued) effect();
  }

  /** Runs `fn` as one transaction outside a request (the socket's commands, the live room's script): kept, or undone if it throws. */
  function atomically(fn) {
    db.begin();
    try {
      sweepStale();
      const result = fn();
      db.commit();
      if (db.dirty) persist();
      flush();
      return result;
    } catch (error) {
      db.rollback();
      effects = [];
      throw error;
    }
  }
  const transact = (fn) => {
    try {
      return atomically(fn);
    } finally {
      armJobs();
    }
  };

  /** The person signed in in this browser (the demo's one visitor), if any. */
  function visitorId() {
    const cookie = overlay.meta.cookie;
    const session = cookie && db.get('sessions', cookie.sessionId);
    return session && !session.revokedAt ? session.userId : null;
  }

  /** Whether the visitor runs this course's classes (an editor of it): then nobody scripted starts or ends them. */
  function visitorRuns(course) {
    const visitor = visitorId();
    const membership = visitor && db.get('memberships', `${course.schoolId}:${visitor}`);
    return Boolean(membership) && canEditCourse({ role: membership.role }, visitor, course);
  }

  // Live updates --------------------------------------------------------------------------------------

  /** What the WebSocket would send: to one person, or to a school's subscribers (`staff`: instructors and up). */
  const deliver = (message) =>
    effects.push(() => {
      for (const listener of [...listeners]) timers.setTimeout(() => listener(message), 0);
    });
  const emitToUser = (userId, event, payload) => deliver({ userId, event, payload });
  const emitToSchool = (schoolId, event, payload, { staff = false } = {}) => deliver({ schoolId, staff, event, payload });
  /** To everyone watching a course's discussions (`course:watch`). */
  const emitToCourse = (courseId, event, payload) => deliver({ course: courseId, event, payload });
  /** To everyone in a live class's room (`live:join`). */
  const emitToLive = (sessionId, event, payload) => deliver({ live: sessionId, event, payload });

  /** Writes a notification for each recipient who wants it in the app, and tells them live (the worker's notify). */
  function notify({ schoolId, recipients, type, data }) {
    const target = db.get('schools', schoolId);
    for (const id of new Set(recipients)) {
      const user = db.get('users', id);
      if (!user || !notificationSettings(user.notificationSettings)[type].inApp) continue;
      const row = db.put('notifications', { id: randomId(), userId: id, schoolId, type, data: { ...data, schoolName: target.name }, createdAt: now(), readAt: null });
      emitToUser(id, 'notification:new', toNotification(row));
    }
  }

  // Later ---------------------------------------------------------------------------------------------

  const schedule = (type, at, payload) => db.put('jobs', { id: randomId(), type, at, payload });

  function armJobs() {
    if (jobTimer !== null) timers.clearTimeout(jobTimer);
    jobTimer = null;
    const stale = db.filter('liveSessions', (row) => row.status === 'live' || row.status === 'scheduled').map((row) => endsAt(row) + STALE_LIVE_MS + 1);
    const next = Math.min(rooms.nextAt(), ...stale, ...db.all('jobs').map((job) => job.at));
    if (Number.isFinite(next)) jobTimer = timers.setTimeout(runJobs, Math.max(0, next - now()));
  }

  /** Runs every job that's due. Safe to call at any time (the tests call it directly). */
  function runJobs() {
    jobTimer = null;
    atomically(() => {});
    const due = db
      .all('jobs')
      .filter((job) => job.at <= now())
      .sort((a, b) => a.at - b.at);
    for (const job of due) {
      // What a job tells people goes out with its changes, or not at all if it fails.
      const told = effects.length;
      db.begin();
      try {
        JOBS[job.type]?.(job.payload);
        db.remove('jobs', job.id);
        db.commit();
      } catch (error) {
        db.rollback();
        effects.splice(told);
        db.remove('jobs', job.id);
        if (import.meta.env.DEV) console.error('Demo job failed', job, error);
      }
    }
    if (due.length) persist();
    flush();
    // The live rooms' script: what classmates say and do now.
    rooms.run(atomically);
    armJobs();
  }

  /** Who grades a course's work: its author while they're on the staff, else an admin or the owner. */
  function graderFor(course) {
    const author = db.get('memberships', `${course.schoolId}:${course.createdBy}`);
    if (author && ROLE_RANK[author.role] >= ROLE_RANK.instructor) return course.createdBy;
    return db.find('memberships', (row) => row.schoolId === course.schoolId && ROLE_RANK[row.role] >= ROLE_RANK.admin)?.userId ?? null;
  }

  function tellGraded({ course, lesson, assignment, submission }) {
    const target = db.get('schools', course.schoolId);
    const graded = submission.status === 'graded';
    notify({
      schoolId: course.schoolId,
      recipients: [submission.userId],
      type: 'assignment.graded',
      data: {
        title: graded ? `${lesson.title} was graded: ${formatPoints(submission.grade ?? 0)}/${assignment.maxPoints}` : `${lesson.title} was returned to you`,
        body: graded ? course.title : `Have a look at the feedback in ${course.title} and hand it in again.`,
        path: `/s/${target.slug}/c/${course.slug}/l/${lesson.id}`,
      },
    });
  }

  function tellSubmitted({ course, lesson, submission }) {
    const target = db.get('schools', course.schoolId);
    const staff = db.filter('memberships', (row) => row.schoolId === course.schoolId && ROLE_RANK[row.role] >= ROLE_RANK.instructor);
    const author = staff.find((row) => row.userId === course.createdBy);
    const recipients = author ? [author.userId] : staff.filter((row) => row.role !== 'instructor').map((row) => row.userId);
    const student = db.get('users', submission.userId);
    notify({
      schoolId: course.schoolId,
      recipients: recipients.filter((id) => id !== submission.userId),
      type: 'assignment.submitted',
      data: {
        title: `${student?.name ?? 'A student'} handed in ${lesson.title}`,
        body: course.title,
        path: `/s/${target.slug}/c/${course.slug}/l/${lesson.id}/submissions/${submission.id}`,
      },
    });
  }

  // Discussions and live classes: what the worker tells people ---------------------------------------

  /** The course's staff for notifications: its author while they're on the staff, else the admins and the owner (the worker's staffFor). */
  function moderatorsOf(course) {
    const staff = db.filter('memberships', (row) => row.schoolId === course.schoolId && ROLE_RANK[row.role] >= ROLE_RANK.instructor);
    const author = staff.find((row) => row.userId === course.createdBy);
    return author ? [author.userId] : staff.filter((row) => row.role !== 'instructor').map((row) => row.userId);
  }

  const enrolledIn = (course) => db.filter('enrollments', (row) => row.courseId === course.id).map((row) => row.userId);
  const nameOf = (userId) => db.get('users', userId)?.name ?? 'Someone';
  const schoolSlugOf = (course) => db.get('schools', course.schoolId)?.slug ?? school.slug;

  function scheduleLiveJobs(session) {
    db.removeWhere('jobs', (job) => job.type === 'liveReminder' && job.payload.sessionId === session.id);
    if (session.status === 'scheduled' && session.startsAt > now()) schedule('liveReminder', Math.max(now(), session.startsAt - REMINDER_MS), { sessionId: session.id });
  }

  /** Starts a class: live now, its students told, the room told (and filling up). */
  function startLive(session, { actorId, course }) {
    const started = db.update('liveSessions', session.id, { status: 'live', startedAt: now() });
    db.removeWhere('jobs', (job) => (job.type === 'liveAutoStart' || job.type === 'liveReminder') && job.payload.sessionId === session.id);
    if (course.status === 'published') {
      notify({
        schoolId: course.schoolId,
        recipients: enrolledIn(course).filter((id) => id !== actorId),
        type: 'live.started',
        data: notices.liveStarted({ school: schoolSlugOf(course), course, session: started }),
      });
    }
    emitToLive(session.id, 'live:status', statusEvent(started));
    rooms.statusChanged(started);
    return started;
  }

  /** Classes left running long after their end are ended; scheduled ones that never started, cancelled (as the worker does). */
  function sweepStale() {
    for (const row of db.filter('liveSessions', (item) => (item.status === 'live' || item.status === 'scheduled') && endsAt(item) + STALE_LIVE_MS < now())) {
      const closed = db.update('liveSessions', row.id, row.status === 'live' ? { status: 'ended', endedAt: now() } : { status: 'cancelled' });
      db.removeWhere('jobs', (job) => job.payload?.sessionId === row.id);
      rooms.statusChanged(closed);
    }
  }

  const JOBS = {
    /** A class starts within 15 minutes: its students and its host hear about it, once. */
    liveReminder({ sessionId }) {
      const session = db.get('liveSessions', sessionId);
      const course = session && db.get('courses', session.courseId);
      if (!course || session.status !== 'scheduled' || session.startsAt <= now() || course.status !== 'published') return;
      notify({
        schoolId: course.schoolId,
        recipients: [...enrolledIn(course), ...(session.createdBy ? [session.createdBy] : [])],
        type: 'live.reminder',
        data: notices.liveReminder({ school: schoolSlugOf(course), course, session, minutes: Math.max(1, Math.round((session.startsAt - now()) / MINUTE)) }),
      });
    },
    /** A seeded class's host goes live on time, unless the visitor runs that course's classes (then it's theirs to start). */
    liveAutoStart({ sessionId }) {
      const session = db.get('liveSessions', sessionId);
      const course = session && db.get('courses', session.courseId);
      if (!course || session.status !== 'scheduled' || !session.createdBy) return;
      if (session.provider === 'youtube' && !session.streamRef) return;
      if (visitorRuns(course)) return;
      startLive(session, { actorId: session.createdBy, course });
    },
    /** A seeded class's host ends it on time, saying goodbye, unless the visitor runs it (then it's theirs to end). */
    liveAutoEnd({ sessionId }) {
      const session = db.get('liveSessions', sessionId);
      const course = session && db.get('courses', session.courseId);
      if (!course || session.status !== 'live' || visitorRuns(course)) return;
      rooms.farewell(session);
      const ended = db.update('liveSessions', session.id, { status: 'ended', endedAt: now() });
      emitToLive(session.id, 'live:status', statusEvent(ended));
      rooms.statusChanged(ended);
    },
    /** The course's instructor grades work handed in, with a grade and a line of feedback. */
    autograde({ submissionId }) {
      const submission = db.get('submissions', submissionId);
      if (submission?.status !== 'submitted') return;
      const lesson = db.get('lessons', submission.lessonId);
      const course = db.get('courses', submission.courseId);
      const assignment = db.get('assignments', submission.lessonId);
      const grader = course && graderFor(course);
      if (!lesson || !assignment || !grader) return;
      const files = db.filter('files', (row) => row.submissionId === submission.id && row.uploaded);
      const verdict = autoGrade({ submission, files, assignment, feedback: content.FEEDBACK ?? [] });
      const saved = db.update('submissions', submission.id, { ...verdict, gradedBy: grader, gradedAt: now(), updatedAt: now() });
      tellGraded({ course, lesson, assignment, submission: saved });
    },
    /** A classmate hands in work they had started, while its instructor is looking. */
    handin({ submissionId }) {
      const submission = db.get('submissions', submissionId);
      if (submission?.status !== 'draft') return;
      const lesson = db.get('lessons', submission.lessonId);
      const course = db.get('courses', submission.courseId);
      if (!lesson || course?.status !== 'published') return;
      const answers = content.ANSWERS?.length ? content.ANSWERS : ['My answer is below.'];
      const body = submission.body.trim() ? submission.body : answers[Math.floor(Math.random() * answers.length)];
      const saved = db.update('submissions', submission.id, { status: 'submitted', body, submittedAt: now(), updatedAt: now() });
      markCompleted({ db, now: now() }, lesson, submission.userId);
      tellSubmitted({ course, lesson, submission: saved });
    },
  };

  // What the routes call around themselves ----------------------------------------------------------

  const server = {
    now,
    secret: () => overlay.meta.secret,
    get db() {
      return db;
    },
    password: content.DEMO_PASSWORD,
    cookie: () => overlay.meta.cookie ?? null,
    setCookie(value) {
      overlay.meta.cookie = value;
    },
    demoSchool: () => db.get('schools', school.id),
    notify,
    emitToUser,
    emitToSchool,
    /** A person just signed in (or picked up their session): an instructor gets a live hand-in, once per visit. */
    signedIn(userId) {
      if (handinsFor.has(userId)) return;
      handinsFor.add(userId);
      const authored = new Set(db.filter('courses', (row) => row.createdBy === userId && row.status === 'published').map((row) => row.id));
      if (!authored.size) return;
      const drafts = db.filter('submissions', (row) => authored.has(row.courseId) && row.status === 'draft' && row.userId !== userId && db.get('users', row.userId)?.key);
      if (!drafts.length) return;
      const pick = drafts.sort((a, b) => b.updatedAt - a.updatedAt)[0];
      schedule('handin', now() + HANDIN_AFTER_MS, { submissionId: pick.id });
    },
    /** Work was handed in: its instructor hears about it, and grades it in about 20 seconds. */
    submitted({ course, lesson, submission }) {
      tellSubmitted({ course, lesson, submission });
      const grader = graderFor(course);
      if (grader && grader !== submission.userId) schedule('autograde', now() + AUTOGRADE_AFTER_MS, { submissionId: submission.id });
    },
    /** Work was graded or returned by hand: its student hears about it, and no automatic grade follows. */
    graded({ course, lesson, assignment, submission }) {
      db.removeWhere('jobs', (job) => job.type === 'autograde' && job.payload.submissionId === submission.id);
      tellGraded({ course, lesson, assignment, submission });
    },
    emitToCourse,
    emitToLive,
    /** A new thread or lesson comment: the course's instructor hears about it. */
    discussionPosted({ course, post }) {
      const lesson = post.lessonId ? db.get('lessons', post.lessonId) : null;
      notify({
        schoolId: course.schoolId,
        recipients: moderatorsOf(course).filter((id) => id !== post.authorId),
        type: 'discussion.posted',
        data: notices.posted({ school: schoolSlugOf(course), course, post, lesson, authorName: nameOf(post.authorId) }),
      });
    },
    /** A reply: the author of the thread or comment it answers hears about it. */
    discussionReplied({ course, post, parent }) {
      if (!parent.authorId || parent.status === 'deleted') return;
      const lesson = parent.lessonId ? db.get('lessons', parent.lessonId) : null;
      notify({
        schoolId: course.schoolId,
        recipients: [parent.authorId].filter((id) => id !== post.authorId),
        type: 'discussion.reply',
        data: notices.replied({ school: schoolSlugOf(course), course, parent, reply: post, lesson, authorName: nameOf(post.authorId) }),
      });
    },
    /** A report: the course's staff hear about it. */
    discussionReported({ course, report }) {
      notify({
        schoolId: course.schoolId,
        recipients: moderatorsOf(course).filter((id) => id !== report.reporterId),
        type: 'discussion.reported',
        data: notices.reported({ school: schoolSlugOf(course), course, report }),
      });
    },
    live: {
      /** A class was scheduled: its students hear about it, and get a reminder 15 minutes before. */
      scheduled({ course, session, actorId }) {
        if (course.status === 'published' && session.status === 'scheduled') {
          notify({
            schoolId: course.schoolId,
            recipients: enrolledIn(course).filter((id) => id !== actorId),
            type: 'live.scheduled',
            data: notices.liveScheduled({ school: schoolSlugOf(course), course, session }),
          });
        }
        scheduleLiveJobs(session);
      },
      start: (session, options) => startLive(session, options),
      /** Its time changed: a new reminder. */
      rescheduled: (session) => scheduleLiveJobs(session),
      /** Ended, cancelled or removed: nothing more to come, and the room empties. */
      closed(session) {
        db.removeWhere('jobs', (job) => job.type.startsWith('live') && job.payload.sessionId === session.id);
        rooms.statusChanged(session.status === 'ended' ? session : { ...session, status: 'cancelled' });
      },
      /**
       * The visitor changed a seeded class themselves (started, ended, cancelled, edited): it's
       * theirs now, kept beyond its occurrence, with its chat and attendance so far.
       */
      adopt(session) {
        if (!session.key || session.adopted) return;
        for (const table of ['liveMessages', 'liveAttendance']) for (const row of db.filter(table, (item) => item.sessionId === session.id)) db.put(table, row);
        db.update('liveSessions', session.id, { adopted: true });
      },
      /** The visitor deleted a seeded class: later occurrences don't bring it back. */
      removed(session) {
        if (!session.key) return;
        overlay.meta.live = { ...overlay.meta.live, removed: [...new Set([...(overlay.meta.live?.removed ?? []), session.key])] };
      },
    },
    files: {
      put: (fileId, blob) => blobs.set(fileId, blob),
      get: (fileId) => blobs.get(fileId) ?? null,
      drop(fileId) {
        blobs.delete(fileId);
        const url = blobUrls.get(fileId);
        if (url) URL.revokeObjectURL(url);
        blobUrls.delete(fileId);
      },
      /** An address that downloads the file: kept in this tab's memory, or a classmate's sample, written out. */
      url(file, { submission, lesson }) {
        if (blobUrls.has(file.id)) return blobUrls.get(file.id);
        let blob = blobs.get(file.id);
        if (!blob && file.sample) {
          const student = db.get('users', submission.userId);
          blob = new Blob([sampleFileText({ studentName: student?.name ?? 'A student', lessonTitle: lesson.title, body: submission.body })], { type: file.contentType });
        }
        if (!blob || typeof URL.createObjectURL !== 'function') return null;
        const url = URL.createObjectURL(blob);
        blobUrls.set(file.id, url);
        blobNames.set(url, file.fileName);
        return url;
      },
      nameFor: (url) => blobNames.get(url) ?? 'download',
    },
  };

  const rooms = createLiveRooms({
    api: {
      get db() {
        return db;
      },
      emitToLive,
      emitToUser,
    },
    chat: social?.LIVE_CHAT ?? null,
    now,
  });

  const router = createRouter();
  for (const register of [auth, schools, courses, learning, notifications, discussions, live, search]) register(router, server);

  // Requests --------------------------------------------------------------------------------------------

  async function handle(url, init) {
    const { pathname, searchParams } = new URL(url, 'http://demo.invalid');
    const method = (init.method ?? 'GET').toUpperCase();
    const found = pathname.startsWith('/api/v1/') ? router.match(method, pathname.slice('/api/v1'.length)) : null;
    if (!found || found.notAllowed) return errorResponse(new HttpError(404, 'not_found', `Cannot ${method} ${pathname}`));
    const { route, params } = found;
    const { options } = route;

    db.begin();
    try {
      sweepStale();
      let authContext = null;
      const header = new Headers(init.headers ?? {}).get('Authorization');
      try {
        authContext = verifyAccess(server, header);
      } catch (error) {
        // A public route works for anyone, so a bad token there is simply ignored.
        if (!options.public) throw error;
      }
      if (!authContext && !options.public) throw unauthenticated();

      let body;
      if (init.body !== undefined && init.body !== null) {
        try {
          body = JSON.parse(init.body);
        } catch {
          throw new HttpError(400, 'bad_request', 'The request could not be read.');
        }
      }
      const ctx = { db, now: now(), auth: authContext, client: { userAgent }, params: { ...params }, query: undefined, body: undefined, school: null };
      if (options.school) ctx.school = schoolAccess(db, authContext.userId, params.slug, options.school);
      for (const [name, schema] of Object.entries(options.params ?? {})) ctx.params[name] = parse(schema, params[name]);
      if (options.query) ctx.query = parse(options.query, Object.fromEntries(searchParams));
      if (options.body) ctx.body = parse(options.body, body);

      const result = await route.handler(ctx);
      db.commit();
      if (db.dirty || method !== 'GET') persist();
      flush();
      return ok(result, options.status ?? (method === 'POST' ? 201 : 200));
    } catch (error) {
      if (error instanceof HttpError && error.keep) {
        db.commit();
        persist();
        flush();
      } else {
        db.rollback();
        effects = [];
      }
      return errorResponse(error);
    } finally {
      armJobs();
    }
  }

  /** A fetch-like function for `/api/v1` addresses: resolves with a Response, after a short, realistic wait. */
  async function fetchLike(url, init = {}) {
    const signal = init.signal;
    if (signal?.aborted) throw abortError();
    const wait = Array.isArray(latency) ? latency[0] + Math.random() * (latency[1] - latency[0]) : latency;
    if (wait > 0) {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, wait);
        signal?.addEventListener(
          'abort',
          () => {
            clearTimeout(timer);
            reject(abortError());
          },
          { once: true },
        );
      });
    }
    if (signal?.aborted) throw abortError();
    return handle(String(url), init);
  }

  // The socket's side (src/demo/socket.js) ----------------------------------------------------------

  const refuse = (code, message) => ({ ok: false, error: { code, message } });
  const done = { ok: true, data: undefined };
  const sent = new Map();

  /** The live room's commands, as the API's gateway and LiveRoomService answer them. */
  const realtime = {
    watchCourse(userId, input) {
      const parsed = watchCourseInput.safeParse(input);
      if (!parsed.success) return refuse('validation_failed', 'Unknown course.');
      const viewing = courseById(db, userId, parsed.data.courseId);
      if (!viewing) return refuse('not_found', "This course doesn't exist.");
      if (!viewing.canJoin) return refuse('enrollment_required', 'Enroll in the course to follow its discussions.');
      return done;
    },
    unwatchCourse(userId, input) {
      return watchCourseInput.safeParse(input).success ? done : refuse('validation_failed', 'Unknown course.');
    },
    join(userId, input) {
      const parsed = liveJoinInput.safeParse(input);
      if (!parsed.success) return refuse('validation_failed', 'Unknown class.');
      return transact(() => {
        const found = sessionById(db, userId, parsed.data.sessionId);
        if (!found) return refuse('not_found', "This class doesn't exist.");
        const { viewing, session } = found;
        if (!viewing.canJoin) return refuse('enrollment_required', 'Enroll in the course to join its classes.');
        if (!roomOpen(session, viewing.host, now())) {
          return session.status === 'scheduled'
            ? refuse('conflict', 'The waiting room opens 15 minutes before the class.')
            : refuse('conflict', session.status === 'cancelled' ? 'This class was cancelled.' : 'This class is over.');
        }
        rooms.join(session, userId);
        recordAttendance(db, session, userId, now());
        const state = {
          session: toSession(db, session, viewing, now()),
          messages: latestMessages(db, session.id, { limit: 50 }).map((row) => toMessage(db, row, viewing.course, viewing.host)),
        };
        return { ok: true, data: { ...state, attendees: rooms.broadcast(session.id) } };
      });
    },
    leave(userId, input) {
      const parsed = liveJoinInput.safeParse(input);
      if (!parsed.success) return refuse('validation_failed', 'Unknown class.');
      const sessionId = parsed.data.sessionId;
      if (!rooms.has(userId, sessionId)) return done;
      return transact(() => {
        const session = db.get('liveSessions', sessionId);
        if (!session) return done;
        rooms.leave(session, userId);
        if (sessionById(db, userId, sessionId)) recordAttendance(db, session, userId, now());
        rooms.broadcast(sessionId);
        return done;
      });
    },
    message(userId, input) {
      const parsed = liveMessageInput.safeParse(input);
      if (!parsed.success) return refuse('validation_failed', parsed.error.issues[0]?.message ?? 'Write a message.');
      const { sessionId, body } = parsed.data;
      if (!rooms.has(userId, sessionId)) return refuse('forbidden', 'Join the class first.');
      return transact(() => {
        const found = sessionById(db, userId, sessionId);
        if (!found || !found.viewing.canJoin) return refuse('forbidden', "You can't post in this class.");
        const { viewing, session } = found;
        if (session.status !== 'scheduled' && session.status !== 'live') return refuse('conflict', 'This class is over.');
        const recent = (sent.get(userId) ?? []).filter((at) => at > now() - CHAT_WINDOW_MS);
        if (recent.length >= CHAT_LIMIT) return refuse('rate_limited', 'Slow down a little: wait a moment before sending more.');
        sent.set(userId, [...recent, now()]);
        const row = db.put('liveMessages', { id: randomId(), schoolId: session.schoolId, sessionId, userId, body, hiddenAt: null, hiddenBy: null, createdAt: now(), scripted: false });
        const message = toMessage(db, row, viewing.course, viewing.host);
        emitToLive(sessionId, 'live:message', message);
        rooms.messaged(session, userId);
        return { ok: true, data: message };
      });
    },
    hand(userId, input) {
      const parsed = liveHandInput.safeParse(input);
      if (!parsed.success) return refuse('validation_failed', 'Unknown class.');
      const { sessionId, raised } = parsed.data;
      if (!rooms.has(userId, sessionId)) return refuse('forbidden', 'Join the class first.');
      return transact(() => {
        const found = sessionById(db, userId, sessionId);
        if (!found) return refuse('not_found', "This class doesn't exist.");
        if (found.session.status !== 'live') return refuse('conflict', 'Hands go up once the class has started.');
        if (found.viewing.host) return refuse('conflict', 'Hosts don’t need to raise a hand.');
        rooms.hand(sessionId, userId, raised);
        return done;
      });
    },
    /** The socket closed: out of every room it was in. */
    disconnected(userId, sessionIds) {
      for (const sessionId of sessionIds) realtime.leave(userId, { sessionId });
    },
  };

  load();
  complain(seed.problems ?? []);

  return {
    fetch: fetchLike,
    runJobs,
    realtime,
    /** Who's in a class's room now (for the tests). */
    attendees: (sessionId) => rooms.attendees(sessionId),
    /** When the current occurrence of the seeded live classes started, and ends (see load). */
    occurrence: () => ({ ...overlay.meta.live }),
    /** Subscribes to what the WebSocket would send. Returns the unsubscribe function. */
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    /** The ack to `school:subscribe`: who's online (the visitor, and a few classmates now and then). */
    presence(userId, slug) {
      const target = db.find('schools', (row) => row.slug === slug);
      const membership = target && db.get('memberships', `${target.id}:${userId}`);
      if (!membership) return { ok: false, error: { code: 'forbidden', message: "You're not a member of this school." } };
      const random = createRandom(`online/${target.id}/${Math.floor(now() / (10 * MINUTE))}`);
      const others = db.filter('memberships', (row) => row.schoolId === target.id && row.userId !== userId).map((row) => row.userId);
      return { ok: true, data: { schoolId: target.id, online: [userId, ...random.sample(others, Math.min(others.length, random.int(2, 5)))] }, role: membership.role };
    },
    /** The people the sign-in page offers, in content order. */
    personas: () =>
      content.PEOPLE.filter((person) => person.persona).map((person) => ({
        id: ids.user(person.key),
        key: person.key,
        name: person.name,
        email: person.email,
        role: person.role,
        label: person.persona,
        blurb: person.blurb,
      })),
    /** The demo school, and its most popular published courses as catalog entries, for the landing page. */
    showcase(limit = 6) {
      const target = db.get('schools', school.id);
      const featured = content.COURSES.filter((spec) => spec.status === 'published')
        .sort((a, b) => b.popularity - a.popularity)
        .slice(0, limit)
        .map((spec) => {
          const course = db.get('courses', ids.course(spec.slug));
          if (!course || course.status !== 'published') return null;
          const lessons = db.filter('lessons', (row) => row.courseId === course.id && row.status === 'published');
          return {
            id: course.id,
            slug: course.slug,
            title: course.title,
            summary: course.summary,
            status: course.status,
            coverUrl: coverUrl(course),
            lessonCount: lessons.length,
            durationSeconds: lessons.reduce((sum, row) => sum + (row.durationSeconds ?? 0), 0),
            enrolled: false,
            progress: null,
            createdAt: new Date(course.createdAt).toISOString(),
            publishedAt: course.publishedAt ? new Date(course.publishedAt).toISOString() : null,
          };
        })
        .filter(Boolean);
      return {
        school: { slug: target?.slug ?? content.SCHOOL.slug, name: target?.name ?? content.SCHOOL.name, description: content.SCHOOL.description ?? '' },
        courses: featured,
        students: db.count('memberships', (row) => row.schoolId === school.id && row.role === 'student'),
        password: content.DEMO_PASSWORD,
      };
    },
    /** Where someone lands after signing in: students on their dashboard, staff in the school. */
    startPage(userId) {
      const membership = db.get('memberships', `${school.id}:${userId}`);
      if (!membership || membership.role === 'student') return '/';
      return `/s/${content.SCHOOL.slug}`;
    },
    /** Forgets every change made in this browser: the demo school is as new, and no one is signed in. */
    reset() {
      storage.remove(STORAGE_KEY);
      for (const fileId of [...blobs.keys()]) server.files.drop(fileId);
      handinsFor.clear();
      rooms.reset();
      sent.clear();
      load({ fresh: true });
      armJobs();
    },
    /** Another tab changed the saved state: pick it up. */
    reload() {
      load();
      armJobs();
    },
    files: server.files,
    get db() {
      return db;
    },
  };
}

/**
 * How the instructor grades work handed in, automatically: very short work with nothing attached
 * is returned with a request for more; the rest gets a grade (more for fuller answers and
 * attachments) and a line of feedback that picks up something from the work itself.
 */
export function autoGrade({ submission, files, assignment, feedback, random = Math.random }) {
  const words = submission.body.trim().split(/\s+/).filter(Boolean);
  if (words.length < 12 && !files.length) {
    return {
      status: 'returned',
      grade: null,
      feedback: 'Thanks for handing this in. It is a little short for me to grade: explain your reasoning in a few sentences, then hand it in again.',
    };
  }
  const share = Math.min(1, Math.max(0.6, 0.72 + (Math.min(words.length, 250) / 250) * 0.2 + (files.length ? 0.05 : 0) + (random() - 0.5) * 0.08));
  const line = feedback.length ? feedback[Math.floor(random() * feedback.length)] : 'Good work.';
  const sentence =
    submission.body
      .split(/(?<=[.!?])\s+|\n+/)
      .find((part) => part.trim().split(/\s+/).length >= 4)
      ?.trim() ?? '';
  const excerptWords = sentence.split(/\s+/);
  const excerpt = excerptWords.length > 12 ? `${excerptWords.slice(0, 12).join(' ')}…` : sentence.replace(/[.!?]$/, '');
  const specific = excerpt ? ` I especially liked “${excerpt}”.` : files.length ? ` Thanks for attaching ${files[0].fileName}; it made your working easy to follow.` : '';
  return { status: 'graded', grade: roundGrade(assignment.maxPoints * share, assignment.maxPoints), feedback: `${line}${specific}` };
}
