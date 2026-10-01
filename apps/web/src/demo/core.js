import { ROLE_RANK, notificationSettings } from '@grand/contracts';

import { HttpError, createRouter, errorResponse, ok, parse, schoolAccess, unauthenticated } from './http.js';
import { createRandom, hash128, randomId, randomToken } from './ids.js';
import { formatPoints } from './logic.js';
import { register as auth, verifyAccess } from './routes/auth.js';
import { register as courses } from './routes/courses.js';
import { register as learning } from './routes/learning.js';
import { register as notifications, toNotification } from './routes/notifications.js';
import { register as schools } from './routes/schools.js';
import { coverUrl, markCompleted } from './routes/shared.js';
import { MINUTE, buildSeed, ids, roundGrade, sampleFileText } from './seed.js';
import { STORAGE_KEY, browserStorage, createDb, readOverlay } from './store.js';
import { validateContent } from './validate.js';

/**
 * The mock API: answers `/api/v1` requests from the page with real Responses, from the demo
 * school's data (seed plus the visitor's saved changes), following the API's rules. Around the
 * routes it does what the API's other parts do: it notifies people (as the worker would, honoring
 * their settings) and tells the page live (as the WebSocket would, through `subscribe`), and it
 * runs a few things later, so the demo feels alive: an instructor grades work handed in about 20
 * seconds after, and a classmate hands in work while an instructor is looking.
 *
 * `createServer` is the testable core; src/demo/server.js makes the app's one instance.
 */

export const AUTOGRADE_AFTER_MS = 20_000;
export const HANDIN_AFTER_MS = 35_000;

const abortError = () => new DOMException('The operation was aborted.', 'AbortError');

export function createServer({
  content,
  media = {},
  now = () => Date.now(),
  storage = browserStorage(),
  latency = [40, 140],
  userAgent = typeof navigator === 'undefined' ? 'Demo' : navigator.userAgent,
  timers = { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (id) => clearTimeout(id) },
  strict = false,
} = {}) {
  const problems = validateContent(content, media).filter((problem) => !/can't be scored on this quiz/.test(problem));
  if (problems.length) {
    if (strict) throw new Error(`The demo content has problems:\n${problems.join('\n')}`);
    if (import.meta.env.DEV) console.error(`The demo content has problems:\n${problems.join('\n')}`);
  }

  const contentHash = hash128(JSON.stringify({ content, media }));
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

  function load({ fresh = false } = {}) {
    if (!seed || fresh) seed = buildSeed({ content, media, now: now() });
    overlay = readOverlay(storage, contentHash);
    overlay.meta ??= {};
    overlay.meta.secret ??= randomToken();
    db = createDb(seed.tables, overlay);
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

  // Live updates --------------------------------------------------------------------------------------

  /** What the WebSocket would send: to one person, or to a school's subscribers (`staff`: instructors and up). */
  const deliver = (message) =>
    effects.push(() => {
      for (const listener of [...listeners]) timers.setTimeout(() => listener(message), 0);
    });
  const emitToUser = (userId, event, payload) => deliver({ userId, event, payload });
  const emitToSchool = (schoolId, event, payload, { staff = false } = {}) => deliver({ schoolId, staff, event, payload });

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
    const next = Math.min(...db.all('jobs').map((job) => job.at));
    if (Number.isFinite(next)) jobTimer = timers.setTimeout(runJobs, Math.max(0, next - now()));
  }

  /** Runs every job that's due. Safe to call at any time (the tests call it directly). */
  function runJobs() {
    jobTimer = null;
    const due = db
      .all('jobs')
      .filter((job) => job.at <= now())
      .sort((a, b) => a.at - b.at);
    for (const job of due) {
      db.begin();
      try {
        JOBS[job.type]?.(job.payload);
        db.remove('jobs', job.id);
        db.commit();
      } catch (error) {
        db.rollback();
        db.remove('jobs', job.id);
        if (import.meta.env.DEV) console.error('Demo job failed', job, error);
      }
    }
    if (due.length) persist();
    flush();
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

  const JOBS = {
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

  const router = createRouter();
  for (const register of [auth, schools, courses, learning, notifications]) register(router, server);

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

  load();

  return {
    fetch: fetchLike,
    runJobs,
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
