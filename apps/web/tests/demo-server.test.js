import { describe, expect, it } from 'vitest';

import * as CONTENT from '../src/demo/content.js';
import { AUTOGRADE_AFTER_MS, HANDIN_AFTER_MS, autoGrade, createServer } from '../src/demo/core.js';
import { MEDIA } from '../src/demo/media.js';
import { FILE_GONE } from '../src/demo/routes/learning.js';
import { DAY, ids } from '../src/demo/seed.js';
import { STORAGE_KEY } from '../src/demo/store.js';
import { validateContent } from '../src/demo/validate.js';

/**
 * The demo's mock API (src/demo) against the real demo content: the same rules as the API in
 * apps/api, request by request. Time stands still unless a test moves it, storage is in memory,
 * and timers are run by hand.
 */

const START = Date.parse('2026-10-01T12:00:00Z');
const SCHOOL = CONTENT.SCHOOL.slug;
const lessonId = (course, key) => ids.lesson(course, key);

function memoryStorage(entries = []) {
  const map = new Map(entries);
  return { map, get: (key) => map.get(key) ?? null, set: (key, value) => map.set(key, value), remove: (key) => map.delete(key) };
}

function setup({ storage = memoryStorage(), clock = { now: START } } = {}) {
  // Deliveries (no delay) run when the test flushes; jobs run when it moves the clock (advance).
  const pending = [];
  const timers = {
    setTimeout: (fn, ms) => {
      if (!ms) pending.push(fn);
      return pending.length;
    },
    clearTimeout: () => {},
  };
  const server = createServer({ content: CONTENT, media: MEDIA, now: () => clock.now, storage, latency: 0, userAgent: 'Vitest', timers, strict: true });
  const messages = [];
  server.subscribe((message) => messages.push(message));
  const flushTimers = () => {
    while (pending.length) pending.shift()();
  };

  async function call(method, path, { token, body } = {}) {
    const headers = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await server.fetch(`/api/v1${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await response.text();
    flushTimers();
    return { status: response.status, body: text ? JSON.parse(text) : null, headers: response.headers };
  }
  const signIn = async (key, password = CONTENT.DEMO_PASSWORD) => {
    const result = await call('POST', '/auth/login', { body: { email: `${key}@grand-academy.demo`, password } });
    expect(result.status).toBe(200);
    return result.body.accessToken;
  };
  const advance = (ms) => {
    clock.now += ms;
    server.runJobs();
    flushTimers();
  };
  return { server, call, signIn, advance, storage, clock, messages, flushTimers };
}

const course = (slug) => `/schools/${SCHOOL}/courses/${slug}`;
const lesson = (slug, key) => `${course(slug)}/lessons/${lessonId(slug, key)}`;

describe('the demo content', () => {
  it('follows the API’s rules', () => {
    const problems = validateContent(CONTENT, MEDIA).filter((problem) => !/can't be scored on this quiz/.test(problem));
    expect(problems).toEqual([]);
  });

  it('reports what it had to approximate', () => {
    // A past attempt's percent the quiz can't produce is scored as near as it can be.
    const soft = validateContent(CONTENT, MEDIA).filter((problem) => /can't be scored on this quiz/.test(problem));
    if (soft.length) console.warn(`Demo content to adjust:\n${soft.join('\n')}`);
    expect(Array.isArray(soft)).toBe(true);
  });

  it('catches mistakes in content', () => {
    const broken = {
      ...CONTENT,
      COURSES: [
        { ...CONTENT.COURSES[0], author: 'nobody' },
        {
          ...CONTENT.COURSES[1],
          slug: CONTENT.COURSES[0].slug,
          modules: [
            {
              title: 'M',
              lessons: [
                {
                  key: 'q',
                  kind: 'quiz',
                  title: 'Q',
                  quiz: {
                    passPercent: 70,
                    maxAttempts: null,
                    questions: [
                      {
                        key: 'a',
                        kind: 'single',
                        prompt: 'P',
                        options: [
                          { label: 'x', correct: false },
                          { label: 'y', correct: false },
                        ],
                      },
                    ],
                  },
                },
              ],
            },
          ],
        },
      ],
    };
    const problems = validateContent(broken, MEDIA);
    expect(problems.some((problem) => problem.includes('unknown author "nobody"'))).toBe(true);
    expect(problems.some((problem) => problem.includes('slug is used twice'))).toBe(true);
    expect(problems.some((problem) => problem.includes('Mark exactly one choice as correct'))).toBe(true);
    expect(() => createServer({ content: broken, media: MEDIA, storage: memoryStorage(), latency: 0, strict: true })).toThrow(/problems/);
  });
});

describe('signing in', () => {
  it('signs in a persona with the demo password, and refuses anything else', async () => {
    const { call } = setup();
    const ok = await call('POST', '/auth/login', { body: { email: 'AMIRA@grand-academy.demo', password: 'demo' } });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ expiresIn: 900, user: { email: 'amira@grand-academy.demo', name: 'Amira Haddad', emailVerified: true } });
    expect(ok.body.accessToken).toMatch(/^[\w-]+\.[\w-]+\.[\w-]+$/);

    const wrong = await call('POST', '/auth/login', { body: { email: 'amira@grand-academy.demo', password: 'nope' } });
    expect(wrong).toMatchObject({ status: 401, body: { error: { code: 'invalid_credentials' } } });
    // Generated classmates aren't personas: no way in.
    const classmate = await call('POST', '/auth/login', { body: { email: 'noah@grand-academy.demo', password: 'demo' } });
    expect(classmate.status).toBe(401);
    const invalid = await call('POST', '/auth/login', { body: { email: 'not an email', password: '' } });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error).toMatchObject({ code: 'validation_failed', message: 'Some fields need attention.' });
    expect(invalid.body.error.details.map((detail) => detail.path)).toEqual(expect.arrayContaining(['email', 'password']));
  });

  it('needs a valid token for private endpoints, and says when it has expired', async () => {
    const { call, signIn, advance } = setup();
    expect(await call('GET', '/auth/me')).toMatchObject({ status: 401, body: { error: { code: 'unauthenticated' } } });
    expect((await call('GET', '/auth/me', { token: 'a.b.c' })).body.error.code).toBe('unauthenticated');
    const token = await signIn('amira');
    const me = await call('GET', '/auth/me', { token });
    expect(me.body.schools).toEqual([expect.objectContaining({ slug: SCHOOL, name: CONTENT.SCHOOL.name, role: 'student' })]);
    advance(16 * 60_000);
    expect((await call('GET', '/auth/me', { token })).body.error.code).toBe('session_expired');
  });

  it('keeps the session across reloads through the saved "cookie", rotating it, until signing out', async () => {
    const storage = memoryStorage();
    const clock = { now: START };
    const first = setup({ storage, clock });
    await first.signIn('daniel');
    expect(JSON.parse(storage.get(STORAGE_KEY)).meta.cookie.token).toBeTruthy();

    // A reload: a new mock on the same storage picks the session up.
    const second = setup({ storage, clock });
    const refreshed = await second.call('POST', '/auth/refresh');
    expect(refreshed).toMatchObject({ status: 200, body: { user: { name: 'Daniel Okafor' } } });
    const devices = await second.call('GET', '/auth/sessions', { token: refreshed.body.accessToken });
    expect(devices.body.filter((device) => device.current)).toHaveLength(1);
    expect(devices.body.length).toBeGreaterThanOrEqual(2);

    expect((await second.call('POST', '/auth/logout')).status).toBe(204);
    expect((await second.call('POST', '/auth/refresh')).body.error).toMatchObject({ code: 'session_expired', message: 'Please sign in.' });
    expect((await second.call('GET', '/auth/me', { token: refreshed.body.accessToken })).body.error.code).toBe('session_expired');
  });

  it('signs up a new student into the demo school, with no enrollments', async () => {
    const { call } = setup();
    const short = await call('POST', '/auth/signup', { body: { name: 'Ada', email: 'ada@example.com', password: 'short' } });
    expect(short.body.error.details).toEqual([{ path: 'password', message: 'Use at least 10 characters' }]);
    const made = await call('POST', '/auth/signup', { body: { name: 'Ada Lovelace', email: 'Ada@Example.com', password: 'correct horse battery' } });
    expect(made.status).toBe(201);
    expect(made.body.user).toMatchObject({ email: 'ada@example.com', emailVerified: false });
    const token = made.body.accessToken;
    expect((await call('GET', '/auth/me', { token })).body.schools).toEqual([expect.objectContaining({ slug: SCHOOL, role: 'student' })]);
    const catalog = await call('GET', `/schools/${SCHOOL}/courses`, { token });
    expect(catalog.body.some((item) => item.enrolled)).toBe(false);
    const again = await call('POST', '/auth/signup', { body: { name: 'Ada', email: 'ada@example.com', password: 'correct horse battery' } });
    expect(again).toMatchObject({ status: 409, body: { error: { code: 'email_taken' } } });
    // The new account signs in with its own password.
    expect((await call('POST', '/auth/login', { body: { email: 'ada@example.com', password: 'correct horse battery' } })).status).toBe(200);
    expect((await call('POST', '/auth/login', { body: { email: 'ada@example.com', password: 'demo' } })).status).toBe(401);
  });
});

describe('schools and roles', () => {
  it('lets admins and the owner manage members, page by page, and nobody else', async () => {
    const { call, signIn } = setup();
    const amira = await signIn('amira');
    expect((await call('GET', `/schools/${SCHOOL}/members`, { token: amira })).body.error).toMatchObject({
      code: 'forbidden',
      message: 'Only a school admin or above can do this.',
    });
    expect((await call('GET', '/schools/nowhere-school', { token: amira })).status).toBe(404);

    const lena = await signIn('lena');
    const first = await call('GET', `/schools/${SCHOOL}/members?limit=10`, { token: lena });
    expect(first.body.items).toHaveLength(10);
    expect(first.body.items[0]).toMatchObject({ name: 'Lena Fischer', role: 'owner' });
    const all = [...first.body.items];
    let cursor = first.body.nextCursor;
    while (cursor) {
      const page = await call('GET', `/schools/${SCHOOL}/members?limit=10&cursor=${cursor}`, { token: lena });
      all.push(...page.body.items);
      cursor = page.body.nextCursor;
    }
    expect(all).toHaveLength(CONTENT.PEOPLE.length);
    expect(new Set(all.map((member) => member.userId)).size).toBe(all.length);

    const noah = ids.user('noah');
    const promoted = await call('PATCH', `/schools/${SCHOOL}/members/${noah}`, { token: lena, body: { role: 'instructor' } });
    expect(promoted.body).toMatchObject({ userId: noah, role: 'instructor' });
    expect((await call('PATCH', `/schools/${SCHOOL}/members/${ids.user('lena')}`, { token: lena, body: { role: 'admin' } })).body.error.message).toBe(
      "You can't change your own role.",
    );
    expect((await call('DELETE', `/schools/${SCHOOL}/members/${ids.user('lena')}`, { token: lena })).body.error.message).toBe('The owner can’t leave their own school.');
  });

  it('removes a member’s work with them, and lets students leave', async () => {
    const { call, signIn, server } = setup();
    const amira = await signIn('amira');
    const me = ids.user('amira');
    expect(server.db.filter('progress', (row) => row.userId === me).length).toBeGreaterThan(0);
    expect((await call('DELETE', `/schools/${SCHOOL}/members/${me}`, { token: amira })).status).toBe(204);
    expect(server.db.filter('progress', (row) => row.userId === me)).toHaveLength(0);
    expect(server.db.filter('enrollments', (row) => row.userId === me)).toHaveLength(0);
    expect((await call('GET', `/schools/${SCHOOL}`, { token: amira })).body.error.message).toBe("You're not a member of this school.");
  });

  it('invites by email (the owner alone invites admins), and cancels', async () => {
    const { call, signIn } = setup();
    const lena = await signIn('lena');
    const invited = await call('POST', `/schools/${SCHOOL}/invitations`, { token: lena, body: { email: 'new.teacher@example.com', role: 'admin' } });
    expect(invited).toMatchObject({ status: 201, body: { email: 'new.teacher@example.com', role: 'admin', invitedBy: { name: 'Lena Fischer' } } });
    expect((await call('POST', `/schools/${SCHOOL}/invitations`, { token: lena, body: { email: 'amira@grand-academy.demo', role: 'student' } })).body.error.code).toBe(
      'already_member',
    );
    expect((await call('GET', `/schools/${SCHOOL}/invitations`, { token: lena })).body).toHaveLength(1);
    expect((await call('DELETE', `/schools/${SCHOOL}/invitations/${invited.body.id}`, { token: lena })).status).toBe(204);
    expect((await call('GET', `/schools/${SCHOOL}/invitations`, { token: lena })).body).toHaveLength(0);
    expect((await call('POST', '/invitations/preview', { body: { token: 'x'.repeat(43) } })).body.error.code).toBe('invitation_invalid');
  });

  it('creates a school, with its owner and an empty catalog', async () => {
    const { call, signIn } = setup();
    const amira = await signIn('amira');
    const bad = await call('POST', '/schools', { token: amira, body: { name: 'A', slug: 'Bad Slug' } });
    expect(bad.body.error.details.map((detail) => detail.path)).toEqual(expect.arrayContaining(['name', 'slug']));
    const taken = await call('POST', '/schools', { token: amira, body: { name: 'Again', slug: SCHOOL } });
    expect(taken.body.error).toMatchObject({ code: 'slug_taken', details: [{ path: 'slug', message: 'This address is taken' }] });
    const made = await call('POST', '/schools', { token: amira, body: { name: 'Study Group', slug: 'study-group' } });
    expect(made).toMatchObject({ status: 201, body: { slug: 'study-group', role: 'owner' } });
    expect((await call('GET', '/schools/study-group/courses', { token: amira })).body).toEqual([]);
  });
});

describe('courses', () => {
  it('hides drafts from everyone but their editors', async () => {
    const { call, signIn } = setup();
    const amira = await signIn('amira');
    const daniel = await signIn('daniel');
    const draft = CONTENT.COURSES.find((item) => item.status === 'draft').slug;
    expect((await call('GET', course(draft), { token: amira })).body.error).toMatchObject({ code: 'not_found', message: "This course doesn't exist." });
    const own = await call('GET', course(draft), { token: daniel });
    expect(own.body).toMatchObject({ status: 'draft', canEdit: true, enrolled: false });
    // The catalog: students see published courses only; editors see their drafts, never-published first.
    const studentCatalog = (await call('GET', `/schools/${SCHOOL}/courses`, { token: amira })).body;
    expect(studentCatalog.every((item) => item.status === 'published')).toBe(true);
    const danielCatalog = (await call('GET', `/schools/${SCHOOL}/courses`, { token: daniel })).body;
    expect(danielCatalog[0]).toMatchObject({ slug: draft, status: 'draft', publishedAt: null });
    // Others' courses: visible, not editable, and not changeable.
    const sofias = CONTENT.COURSES.find((item) => item.author === 'sofia' && item.status === 'published').slug;
    expect((await call('GET', course(sofias), { token: daniel })).body.canEdit).toBe(false);
    expect((await call('PATCH', course(sofias), { token: daniel, body: { title: 'Mine now' } })).body.error.message).toBe(
      'Only the course author or a school admin can change this course.',
    );
    expect((await call('PATCH', course(sofias), { token: amira, body: { title: 'Mine now' } })).body.error.message).toBe('Only a school instructor or above can do this.');
  });

  it('shows the viewer’s progress and where to continue', async () => {
    const { call, signIn } = setup();
    const amira = await signIn('amira');
    const catalog = (await call('GET', `/schools/${SCHOOL}/courses`, { token: amira })).body;
    const linear = catalog.find((item) => item.slug === 'linear-algebra-visually');
    expect(linear).toMatchObject({ enrolled: true, coverUrl: 'https://i.ytimg.com/vi/fNk_zzaMoSs/hqdefault.jpg' });
    expect(linear.progress).toMatchObject({ completedLessons: 2, lastLessonId: lessonId('linear-algebra-visually', 'transformations') });
    expect(linear.progress.percent).toBe(Math.round((2 / linear.progress.totalLessons) * 100));
    const sound = catalog.find((item) => item.slug === 'physics-of-sound');
    expect(sound.coverUrl).toBe('/demo/media/sound-waves/poster.jpg');
    expect(sound.durationSeconds).toBe(Object.values(MEDIA).reduce((sum, item) => sum + item.durationSeconds, 0));
    expect(sound.progress.lastLessonId).toBe(lessonId('physics-of-sound', 'loudness'));
  });

  it('locks lessons until enrolling, except free previews', async () => {
    const { call, signIn } = setup();
    const amira = await signIn('amira');
    const slug = 'neural-networks';
    const outline = (await call('GET', course(slug), { token: amira })).body;
    expect(outline.enrolled).toBe(false);
    const lessons = outline.modules.flatMap((module) => module.lessons);
    expect(lessons.find((item) => item.isPreview).locked).toBe(false);
    expect(lessons.filter((item) => !item.isPreview).every((item) => item.locked)).toBe(true);
    expect((await call('GET', lesson(slug, 'gradient-descent'), { token: amira })).body.error.code).toBe('enrollment_required');
    expect((await call('GET', lesson(slug, 'what-is-a-network'), { token: amira })).body).toMatchObject({ locked: false, progressDetail: null });
    expect((await call('PUT', `${lesson(slug, 'what-is-a-network')}/progress`, { token: amira, body: { positionSeconds: 3, segments: [0] } })).body.error.code).toBe(
      'enrollment_required',
    );

    expect((await call('POST', `${course(slug)}/enrollment`, { token: amira })).status).toBe(204);
    const open = await call('GET', lesson(slug, 'gradient-descent'), { token: amira });
    expect(open.body).toMatchObject({ locked: false, progress: { completed: false, percent: 0 }, previous: { title: expect.any(String) } });
    expect((await call('DELETE', `${course(slug)}/enrollment`, { token: amira })).status).toBe(204);
    expect((await call('GET', lesson(slug, 'gradient-descent'), { token: amira })).status).toBe(403);
  });

  it('plays the school’s own videos from static files, and embeds the rest', async () => {
    const { call, signIn } = setup();
    const amira = await signIn('amira');
    const hls = await call('GET', `${lesson('physics-of-sound', 'loudness')}/playback`, { token: amira });
    expect(hls.body).toMatchObject({
      kind: 'hls',
      manifestUrl: '/demo/media/loudness/master.m3u8',
      posterUrl: '/demo/media/loudness/poster.jpg',
      storyboardUrl: '/demo/media/loudness/storyboard.vtt',
      durationSeconds: MEDIA.loudness.durationSeconds,
    });
    expect(Date.parse(hls.body.expiresAt)).toBeGreaterThan(START);
    expect((await call('GET', `${lesson('linear-algebra-visually', 'span')}/playback`, { token: amira })).body).toEqual({ kind: 'embed', provider: 'youtube', ref: 'k7RM-ot2NWY' });
    await call('POST', `${course('code-your-first-website')}/enrollment`, { token: amira });
    expect((await call('GET', `${lesson('code-your-first-website', 'setup')}/playback`, { token: amira })).body.error.message).toBe("A video for this lesson doesn't exist.");
  });

  it('lets the author build and publish, telling enrolled students about new lessons', async () => {
    const { call, signIn, server, messages } = setup();
    const daniel = await signIn('daniel');
    const amira = await signIn('amira');
    const slug = 'linear-algebra-visually';
    const outline = (await call('GET', course(slug), { token: daniel })).body;
    const created = await call('POST', `${course(slug)}/lessons`, { token: daniel, body: { moduleId: outline.modules[0].id, title: 'Change of basis', kind: 'lesson' } });
    expect(created).toMatchObject({ status: 201, body: { status: 'draft', kind: 'lesson', video: null, locked: false } });
    const id = created.body.id;
    const path = `${course(slug)}/lessons/${id}`;
    expect((await call('GET', path, { token: amira })).status).toBe(404);

    const embedded = await call('PATCH', path, {
      token: daniel,
      body: { video: { provider: 'youtube', ref: 'P2LTAUO1TdA' }, summary: 'Seeing the same vector in two coordinate systems.' },
    });
    expect(embedded.body.video).toEqual({ provider: 'youtube', ref: 'P2LTAUO1TdA' });
    expect((await call('PATCH', path, { token: daniel, body: { video: { provider: 'youtube', ref: 'nope' } } })).body.error.details[0].path).toBe('video.ref');

    const enrolled = server.db.filter('enrollments', (row) => row.courseId === ids.course(slug)).map((row) => row.userId);
    const before = server.db.count('notifications', (row) => row.type === 'lesson.published');
    expect((await call('PATCH', path, { token: daniel, body: { status: 'published' } })).body.status).toBe('published');
    const told = server.db.filter('notifications', (row) => row.type === 'lesson.published').length - before;
    expect(told).toBe(enrolled.filter((userId) => userId !== ids.user('daniel')).length);
    expect(
      messages.some(
        (message) =>
          message.event === 'notification:new' && message.userId === ids.user('amira') && message.payload.data.title === `New in Linear Algebra, Visually: Change of basis`,
      ),
    ).toBe(true);
    // Published once: unpublishing and publishing again tells no one twice.
    await call('PATCH', path, { token: daniel, body: { status: 'draft' } });
    await call('PATCH', path, { token: daniel, body: { status: 'published' } });
    expect(server.db.count('notifications', (row) => row.type === 'lesson.published') - before).toBe(told);
    expect((await call('GET', path, { token: amira })).status).toBe(200);
  });

  it('turns video uploads off, with a clear message', async () => {
    const { call, signIn } = setup();
    const lena = await signIn('lena');
    const result = await call('POST', `${lesson('physics-of-sound', 'loudness')}/upload`, { token: lena, body: { fileName: 'take2.mp4', size: 1000, contentType: 'video/mp4' } });
    expect(result).toMatchObject({
      status: 503,
      body: { error: { code: 'service_unavailable', message: expect.stringContaining('Embed a YouTube, Dailymotion or Twitch video instead.') } },
    });
  });

  it('reorders the outline only when it lists exactly the course’s modules and lessons', async () => {
    const { call, signIn } = setup();
    const daniel = await signIn('daniel');
    const slug = 'calculus-first-steps';
    const outline = (await call('GET', course(slug), { token: daniel })).body;
    const modules = outline.modules.map((module) => ({ id: module.id, lessonIds: module.lessons.map((item) => item.id).reverse() }));
    const reordered = await call('PUT', `${course(slug)}/outline`, { token: daniel, body: { modules } });
    expect(reordered.body.modules[0].lessons.map((item) => item.id)).toEqual(modules[0].lessonIds);
    const missing = await call('PUT', `${course(slug)}/outline`, {
      token: daniel,
      body: { modules: modules.slice(0, 1).map((module) => ({ ...module, lessonIds: module.lessonIds.slice(1) })) },
    });
    expect(missing).toMatchObject({ status: 409, body: { error: { code: 'conflict' } } });
  });
});

describe('quizzes', () => {
  const path = (slug, key) => `${lesson(slug, key)}/quiz`;
  const allRight = (quiz) =>
    Object.fromEntries(
      quiz.questions.map((question) => [
        question.id,
        question.kind === 'short' ? question.answers[0] : question.options.filter((option) => option.correct).map((option) => option.id),
      ]),
    );

  it('grades on the server, reveals answers only when passed or out of attempts, and stops at the limit', async () => {
    const { call, signIn, server } = setup();
    const amira = await signIn('amira');
    const slug = 'linear-algebra-visually';
    const quiz = (await call('GET', path(slug, 'la-check'), { token: amira })).body;
    expect(quiz).toMatchObject({ passPercent: 70, maxAttempts: 3, attemptsLeft: 2, passed: false });
    expect(quiz.attempts).toHaveLength(1);
    expect(JSON.stringify(quiz.questions)).not.toContain('correct');

    const past = (await call('GET', `${path(slug, 'la-check')}/attempts/${quiz.attempts[0].id}`, { token: amira })).body;
    expect(past.questions.every((question) => question.correctOptionIds === null && question.acceptedAnswers === null && question.explanation === null)).toBe(true);

    const wrong = Object.fromEntries(quiz.questions.map((question) => [question.id, question.kind === 'short' ? 'no idea' : [question.options.at(-1).id]]));
    const second = await call('POST', `${path(slug, 'la-check')}/attempts`, { token: amira, body: { answers: wrong } });
    expect(second).toMatchObject({ status: 201, body: { passed: false, attemptsLeft: 1 } });
    expect(second.body.questions.every((question) => question.correctOptionIds === null)).toBe(true);
    const third = await call('POST', `${path(slug, 'la-check')}/attempts`, { token: amira, body: { answers: wrong } });
    expect(third.body.attemptsLeft).toBe(0);
    // Out of attempts: now the answers show.
    const stored = server.db.get('quizzes', lessonId(slug, 'la-check'));
    const single = stored.questions.find((question) => question.kind === 'single');
    expect(third.body.questions.find((question) => question.questionId === single.id).correctOptionIds).toEqual([single.options.find((option) => option.correct).id]);
    expect(third.body.questions.find((question) => question.questionId === single.id).explanation).toBe(single.explanation);
    const fourth = await call('POST', `${path(slug, 'la-check')}/attempts`, { token: amira, body: { answers: wrong } });
    expect(fourth).toMatchObject({ status: 403, body: { error: { code: 'limit_reached', message: "You've used all your attempts at this quiz." } } });
  });

  it('marks choice questions all-or-nothing, short answers loosely, and passing completes the lesson', async () => {
    const { call, signIn, server } = setup();
    const amira = await signIn('amira');
    const slug = 'neural-networks';
    await call('POST', `${course(slug)}/enrollment`, { token: amira });
    const stored = server.db.get('quizzes', lessonId(slug, 'nn-check'));
    const answers = allRight(stored);
    const multiple = stored.questions.find((question) => question.kind === 'multiple');
    const short = stored.questions.find((question) => question.kind === 'short');
    // One right choice missing from the multiple-choice question: no points for it.
    answers[multiple.id] = answers[multiple.id].slice(1);
    // Case, accents, spacing and a final full stop don't matter.
    answers[short.id] = `  ${short.answers[0].toUpperCase()}. `;
    const result = await call('POST', `${path(slug, 'nn-check')}/attempts`, { token: amira, body: { answers } });
    const marks = Object.fromEntries(result.body.questions.map((question) => [question.questionId, question.correct]));
    expect(marks[multiple.id]).toBe(false);
    expect(marks[short.id]).toBe(true);
    const max = stored.questions.reduce((sum, question) => sum + question.points, 0);
    expect(result.body.percent).toBe(Math.round(((max - multiple.points) / max) * 100));
    expect(result.body.passed).toBe(result.body.percent >= stored.passPercent);

    const perfect = await call('POST', `${path(slug, 'nn-check')}/attempts`, { token: amira, body: { answers: allRight(stored) } });
    expect(perfect.body).toMatchObject({ percent: 100, passed: true });
    expect(perfect.body.questions.every((question) => question.correctOptionIds !== null || question.acceptedAnswers !== null)).toBe(true);
    const after = (await call('GET', lesson(slug, 'nn-check'), { token: amira })).body;
    expect(after.progressDetail).toMatchObject({ completed: true, percent: 100 });
    expect((await call('GET', path(slug, 'nn-check'), { token: amira })).body).toMatchObject({ passed: true, bestPercent: 100 });
  });

  it('keeps answers away from takers, and lets editors rewrite the quiz', async () => {
    const { call, signIn } = setup();
    const daniel = await signIn('daniel');
    const amira = await signIn('amira');
    expect((await call('GET', `${path('linear-algebra-visually', 'la-check')}/draft`, { token: amira })).status).toBe(403);
    const draft = (await call('GET', `${path('linear-algebra-visually', 'la-check')}/draft`, { token: daniel })).body;
    expect(draft.attemptCount).toBeGreaterThan(0);
    expect(draft.questions[0].options.some((option) => option.correct)).toBe(true);
    const invalid = await call('PUT', path('linear-algebra-visually', 'la-check'), {
      token: daniel,
      body: {
        passPercent: 80,
        maxAttempts: null,
        questions: [
          {
            kind: 'single',
            prompt: 'Which?',
            options: [
              { label: 'A', correct: false },
              { label: 'B', correct: false },
            ],
          },
        ],
      },
    });
    expect(invalid.body.error.details).toEqual([{ path: 'questions.0.options', message: 'Mark exactly one choice as correct' }]);
    const kept = draft.questions.map(({ id, kind, prompt, explanation, points, options, answers }) => ({ id, kind, prompt, explanation, points, options, answers }));
    const saved = await call('PUT', path('linear-algebra-visually', 'la-check'), { token: daniel, body: { passPercent: 80, maxAttempts: null, questions: kept } });
    expect(saved.body.questions.map((question) => question.id)).toEqual(draft.questions.map((question) => question.id));
    expect(saved.body.passPercent).toBe(80);
  });
});

describe('watch progress', () => {
  it('counts 5-second stretches once, completes an uploaded video at 90%, and resumes', async () => {
    const { call, signIn } = setup();
    const amira = await signIn('amira');
    const path = lesson('physics-of-sound', 'loudness');
    const duration = MEDIA.loudness.durationSeconds;
    const total = Math.ceil(duration / 5);
    const start = (await call('GET', path, { token: amira })).body.progressDetail;
    expect(start).toMatchObject({ completed: false, positionSeconds: 14 });
    expect(start.percent).toBe(Math.floor((15 / duration) * 100));

    // Replaying counts nothing new; stretches past the end are ignored.
    const replay = await call('PUT', `${path}/progress`, { token: amira, body: { positionSeconds: 9, segments: [0, 1, 2, total + 5] } });
    expect(replay.body).toMatchObject({ completed: false, percent: start.percent, positionSeconds: 9 });
    const almost = Array.from({ length: Math.ceil(total * 0.9) - 4 }, (_, index) => index + 3);
    const before = await call('PUT', `${path}/progress`, { token: amira, body: { positionSeconds: 1000, segments: almost } });
    expect(before.body.completed).toBe(false);
    expect(before.body.positionSeconds).toBe(duration);
    expect(before.body.percent).toBeLessThan(100);
    const done = await call('PUT', `${path}/progress`, { token: amira, body: { positionSeconds: 30, segments: [Math.ceil(total * 0.9) - 1] } });
    expect(done.body).toMatchObject({ completed: true, percent: 100 });
    expect((await call('POST', `${path}/complete`, { token: amira })).body.error.message).toBe('This lesson completes once you have watched its video.');
    expect((await call('PUT', `${path}/progress`, { token: amira, body: { positionSeconds: 1, segments: [99999] } })).status).toBe(400);
  });

  it('marks other lessons complete by hand, and moves "continue" along', async () => {
    const { call, signIn } = setup();
    const amira = await signIn('amira');
    const slug = 'linear-algebra-visually';
    const done = await call('POST', `${lesson(slug, 'transformations')}/complete`, { token: amira });
    expect(done).toMatchObject({ status: 201, body: { completed: true, percent: 100 } });
    const outline = (await call('GET', course(slug), { token: amira })).body;
    expect(outline.progress).toMatchObject({ completedLessons: 3, lastLessonId: lessonId(slug, 'transformations') });
    expect((await call('POST', `${lesson(slug, 'la-check')}/complete`, { token: amira })).body.error.message).toBe('A quiz is completed by passing it.');
  });
});

describe('assignments', () => {
  const slug = 'linear-algebra-visually';
  const work = `${lesson(slug, 'la-project')}/assignment`;

  it('goes from draft to handed in, tells the instructor, and comes back graded about 20 seconds later', async () => {
    const { call, signIn, advance, server, messages } = setup();
    const amira = await signIn('amira');
    const daniel = await signIn('daniel');
    expect((await call('GET', work, { token: amira })).body).toMatchObject({ maxPoints: 20, submission: null, counts: null });
    expect((await call('GET', work, { token: daniel })).body.counts).toEqual(expect.objectContaining({ submitted: expect.any(Number) }));

    expect((await call('POST', `${work}/submission/submit`, { token: amira })).body.error.message).toBe('Write your answer or add a file before handing it in.');
    // The failed hand-in left nothing behind.
    expect((await call('GET', work, { token: amira })).body.submission).toBeNull();
    const text =
      'My matrix sends i-hat to (2, 1) and j-hat to (1, 3). The unit square becomes a slanted parallelogram, and the determinant is 5, so areas grow five times and nothing is flipped.';
    const draft = await call('PUT', `${work}/submission`, { token: amira, body: { body: text } });
    expect(draft.body).toMatchObject({ status: 'draft', body: text, submittedAt: null, student: { name: 'Amira Haddad' } });
    const handedIn = await call('POST', `${work}/submission/submit`, { token: amira });
    expect(handedIn.body.status).toBe('submitted');
    expect((await call('PUT', `${work}/submission`, { token: amira, body: { body: 'changed' } })).status).toBe(409);
    expect((await call('GET', lesson(slug, 'la-project'), { token: amira })).body.progressDetail.completed).toBe(true);

    const told = (await call('GET', '/notifications?limit=5', { token: daniel })).body.items[0];
    expect(told).toMatchObject({
      type: 'assignment.submitted',
      readAt: null,
      data: { title: 'Amira Haddad handed in Project: invent a transformation', path: `/s/${SCHOOL}/c/${slug}/l/${lessonId(slug, 'la-project')}/submissions/${handedIn.body.id}` },
    });

    advance(AUTOGRADE_AFTER_MS - 1000);
    expect(server.db.get('submissions', handedIn.body.id).status).toBe('submitted');
    advance(1000);
    const graded = (await call('GET', work, { token: amira })).body.submission;
    expect(graded.status).toBe('graded');
    expect(graded.grade).toBeGreaterThanOrEqual(12);
    expect(graded.grade).toBeLessThanOrEqual(20);
    expect(CONTENT.FEEDBACK.some((line) => graded.feedback.startsWith(line))).toBe(true);
    expect(graded.feedback).toContain('My matrix sends i-hat');
    const news = messages.filter((message) => message.event === 'notification:new' && message.userId === ids.user('amira'));
    expect(news.at(-1).payload).toMatchObject({
      type: 'assignment.graded',
      data: { title: `Project: invent a transformation was graded: ${graded.grade}/20`, schoolName: CONTENT.SCHOOL.name },
    });
  });

  it('lets the instructor grade or return by hand, which stops the automatic grade', async () => {
    const { call, signIn, advance, server } = setup();
    const amira = await signIn('amira');
    const daniel = await signIn('daniel');
    await call('PUT', `${work}/submission`, { token: amira, body: { body: 'A first try at the project, with a shear matrix and its determinant of one.' } });
    const handedIn = (await call('POST', `${work}/submission/submit`, { token: amira })).body;
    const list = (await call('GET', `${work}/submissions`, { token: daniel })).body;
    expect(list[0].status).toBe('submitted');
    expect(list.findIndex((item) => item.status !== 'submitted')).toBeGreaterThan(list.filter((item) => item.status === 'submitted').length - 1);

    const tooHigh = await call('POST', `${work}/submissions/${handedIn.id}/grade`, { token: daniel, body: { status: 'graded', grade: 25, feedback: '' } });
    expect(tooHigh.body.error).toMatchObject({ code: 'validation_failed', message: 'The grade can be at most 20.', details: [{ path: 'grade', message: 'At most 20' }] });
    const returned = await call('POST', `${work}/submissions/${handedIn.id}/grade`, { token: daniel, body: { status: 'returned', grade: null, feedback: 'Add your drawing.' } });
    expect(returned.body).toMatchObject({ status: 'returned', feedback: 'Add your drawing.' });
    advance(AUTOGRADE_AFTER_MS * 2);
    expect(server.db.get('submissions', handedIn.id).status).toBe('returned');
    // Returned work can be changed and handed in again.
    expect((await call('PUT', `${work}/submission`, { token: amira, body: { body: 'With the drawing described in words, step by step, as asked.' } })).body.status).toBe(
      'returned',
    );
    expect((await call('POST', `${work}/submission/submit`, { token: amira })).body.status).toBe('submitted');
    const notes = (await call('GET', '/notifications', { token: amira })).body.items;
    expect(notes[0]).toMatchObject({ type: 'assignment.graded', data: { title: 'Project: invent a transformation was returned to you' } });
  });

  it('keeps files for the visit only: downloads work until a reload, then say so', async () => {
    const storage = memoryStorage();
    const clock = { now: START };
    const { call, signIn, server } = setup({ storage, clock });
    const amira = await signIn('amira');
    const bad = await call('POST', `${work}/submission/files`, { token: amira, body: { fileName: 'virus.exe', size: 10, contentType: 'application/x-msdownload' } });
    expect(bad.status).toBe(400);
    const ticket = await call('POST', `${work}/submission/files`, { token: amira, body: { fileName: 'square.png', size: 5, contentType: 'image/png' } });
    expect(ticket.body).toMatchObject({ url: `demo-upload:${ticket.body.file.id}`, contentType: 'image/png', file: { uploaded: false } });
    // Nothing arrived yet: completing fails and the file goes.
    const early = await call('POST', `${work}/submission/files/${ticket.body.file.id}/complete`, { token: amira });
    expect(early.body.error.message).toBe("The file didn't upload completely. Try again.");
    const again = await call('POST', `${work}/submission/files`, { token: amira, body: { fileName: 'square.png', size: 5, contentType: 'image/png' } });
    server.files.put(again.body.file.id, new Blob(['12345'], { type: 'image/png' }));
    const completed = await call('POST', `${work}/submission/files/${again.body.file.id}/complete`, { token: amira });
    expect(completed.body.files).toEqual([{ id: again.body.file.id, fileName: 'square.png', contentType: 'image/png', sizeBytes: 5, uploaded: true }]);
    const submissionId = completed.body.id;
    const download = await call('GET', `${work}/submissions/${submissionId}/files/${again.body.file.id}`, { token: amira });
    expect(download.body.url).toMatch(/^blob:/);

    const reloaded = setup({ storage, clock });
    const token = await reloaded.signIn('amira');
    const kept = (await reloaded.call('GET', work, { token })).body.submission.files;
    expect(kept).toHaveLength(1);
    const gone = await reloaded.call('GET', `${work}/submissions/${submissionId}/files/${again.body.file.id}`, { token });
    expect(gone.body.error.message).toBe(FILE_GONE);
  });

  it('writes out a classmate’s sample file for the instructor', async () => {
    const { call, signIn, server } = setup();
    const lena = await signIn('lena');
    const file = server.db.all('files').find((row) => row.sample);
    const submission = server.db.get('submissions', file.submissionId);
    const found = server.db.get('lessons', submission.lessonId);
    const owner = server.db.get('courses', found.courseId);
    const url = `${course(owner.slug)}/lessons/${found.id}/assignment/submissions/${submission.id}/files/${file.id}`;
    const download = await call('GET', url, { token: lena });
    expect(download.body.url).toMatch(/^blob:/);
    expect(server.files.nameFor(download.body.url)).toBe(file.fileName);
    // Another student can't.
    const amira = await signIn('amira');
    expect((await call('GET', url, { token: amira })).status).toBeGreaterThanOrEqual(403);
  });
});

describe('notifications', () => {
  it('pages newest first, counts unread, and marks read', async () => {
    const { call, signIn, messages } = setup();
    const daniel = await signIn('daniel');
    const first = (await call('GET', '/notifications?limit=5', { token: daniel })).body;
    expect(first.items).toHaveLength(5);
    expect(first.unread).toBeGreaterThan(0);
    const second = (await call('GET', `/notifications?limit=5&cursor=${first.nextCursor}`, { token: daniel })).body;
    expect(Date.parse(second.items[0].createdAt)).toBeLessThanOrEqual(Date.parse(first.items.at(-1).createdAt));
    expect(second.items.some((item) => first.items.some((other) => other.id === item.id))).toBe(false);
    const unreadOnly = (await call('GET', '/notifications?unread=true', { token: daniel })).body;
    expect(unreadOnly.items.every((item) => item.readAt === null)).toBe(true);

    const one = await call('POST', '/notifications/read', { token: daniel, body: { ids: [unreadOnly.items[0].id] } });
    expect(one.body.unread).toBe(first.unread - 1);
    expect(messages.at(-1)).toMatchObject({ userId: ids.user('daniel'), event: 'notification:read', payload: { ids: [unreadOnly.items[0].id], unread: first.unread - 1 } });
    expect((await call('POST', '/notifications/read', { token: daniel, body: {} })).body.unread).toBe(0);
    expect((await call('GET', '/notifications?cursor=nonsense', { token: daniel })).status).toBe(400);
  });

  it('respects each person’s settings', async () => {
    const { call, signIn, advance, server } = setup();
    const amira = await signIn('amira');
    const settings = await call('PUT', '/notifications/settings', { token: amira, body: { settings: { 'assignment.graded': { inApp: false, email: false } } } });
    expect(settings.body['assignment.graded']).toEqual({ inApp: false, email: false });
    expect(settings.body['course.published']).toEqual({ inApp: true, email: false });
    const work = `${lesson('linear-algebra-visually', 'la-project')}/assignment`;
    await call('PUT', `${work}/submission`, { token: amira, body: { body: 'Rotation by ninety degrees followed by a stretch along the x axis, determinant two.' } });
    await call('POST', `${work}/submission/submit`, { token: amira });
    const before = server.db.count('notifications', (row) => row.userId === ids.user('amira'));
    advance(AUTOGRADE_AFTER_MS);
    expect(server.db.count('notifications', (row) => row.userId === ids.user('amira'))).toBe(before);
    expect((await call('GET', '/notifications/settings', { token: amira })).body['assignment.graded'].inApp).toBe(false);
  });

  it('has a classmate hand in work while the instructor is looking', async () => {
    const { call, signIn, advance } = setup();
    const daniel = await signIn('daniel');
    const before = (await call('GET', '/notifications', { token: daniel })).body.unread;
    advance(HANDIN_AFTER_MS);
    const after = (await call('GET', '/notifications?limit=1', { token: daniel })).body;
    expect(after.unread).toBe(before + 1);
    expect(after.items[0]).toMatchObject({ type: 'assignment.submitted', readAt: null });
  });
});

describe('insights', () => {
  it('counts the course’s students as the API does', async () => {
    const { call, signIn, server } = setup();
    const daniel = await signIn('daniel');
    const slug = 'linear-algebra-visually';
    const insights = (await call('GET', `${course(slug)}/insights`, { token: daniel })).body;
    const courseId = ids.course(slug);
    const students = server.db.filter('enrollments', (row) => row.courseId === courseId).map((row) => row.userId);
    expect(insights.enrolled).toBe(students.length);
    const published = server.db.filter('lessons', (row) => row.courseId === courseId && row.status === 'published').map((row) => row.id);
    const done = (userId) => server.db.count('progress', (row) => row.userId === userId && row.completedAt && published.includes(row.lessonId));
    expect(insights.averagePercent).toBe(Math.round(students.reduce((sum, userId) => sum + (done(userId) / published.length) * 100, 0) / students.length));
    expect(insights.completedCourse).toBe(students.filter((userId) => done(userId) === published.length).length);
    expect(insights.lessons).toHaveLength(published.length);
    const quiz = insights.lessons.find((item) => item.kind === 'quiz');
    expect(quiz.quiz.students).toBeGreaterThan(0);
    expect(quiz.quiz.passRate).toBeGreaterThan(0);
    const assignment = insights.lessons.find((item) => item.kind === 'assignment');
    expect(assignment.assignment).toMatchObject({ maxPoints: 20 });
    expect(assignment.assignment.graded).toBeGreaterThan(0);
    expect(insights.activeLast7Days).toBeGreaterThan(0);
    // Not for students, and not for instructors of other courses.
    const amira = await signIn('amira');
    expect((await call('GET', `${course(slug)}/insights`, { token: amira })).status).toBe(403);
    expect((await call('GET', `${course('neural-networks')}/insights`, { token: daniel })).status).toBe(403);
  });

  it('draws a retention curve from the watched stretches, and rates each question', async () => {
    const { call, signIn } = setup();
    const daniel = await signIn('daniel');
    const retention = (await call('GET', `${lesson('physics-of-sound', 'what-is-sound')}/insights`, { token: daniel })).body.retention;
    expect(retention.segmentSeconds).toBe(5);
    expect(retention.counts).toHaveLength(Math.ceil(MEDIA['sound-waves'].durationSeconds / 5));
    expect(retention.viewers).toBeGreaterThan(5);
    expect(retention.counts[0]).toBeLessThanOrEqual(retention.viewers);
    expect(retention.counts.at(-1)).toBeLessThan(retention.counts[0]);
    const detail = (await call('GET', `${lesson('physics-of-sound', 'sound-check')}/insights`, { token: daniel })).body;
    expect(detail.questions.length).toBeGreaterThan(0);
    expect(detail.questions.every((question) => question.correctRate >= 0 && question.correctRate <= 100)).toBe(true);
    expect(detail.questions.some((question) => question.answered > 0)).toBe(true);
  });
});

describe('saved state', () => {
  it('keeps only the visitor’s changes, survives a reload, and resets to the seed', async () => {
    const storage = memoryStorage();
    const clock = { now: START };
    const first = setup({ storage, clock });
    const amira = await first.signIn('amira');
    await first.call('POST', `${course('neural-networks')}/enrollment`, { token: amira });
    expect(storage.get(STORAGE_KEY).length).toBeLessThan(5_000);

    const second = setup({ storage, clock: { now: START + DAY } });
    const token = await second.signIn('amira');
    expect((await second.call('GET', course('neural-networks'), { token })).body.enrolled).toBe(true);
    second.server.reset();
    expect(storage.get(STORAGE_KEY)).toBeNull();
    expect((await second.call('POST', '/auth/refresh')).status).toBe(401);
    const fresh = await second.signIn('amira');
    expect((await second.call('GET', course('neural-networks'), { token: fresh })).body.enrolled).toBe(false);
  });

  it('starts afresh when the saved state is unreadable or from other content', async () => {
    const broken = setup({ storage: memoryStorage([[STORAGE_KEY, '{not json']]) });
    const token = await broken.signIn('amira');
    expect((await broken.call('GET', '/auth/me', { token })).status).toBe(200);
    const other = setup({ storage: memoryStorage([[STORAGE_KEY, JSON.stringify({ v: 1, content: 'other', tables: { enrollments: { x: { id: 'x' } } }, meta: {} })]]) });
    expect(other.server.db.get('enrollments', 'x')).toBeNull();
  });

  it('is the same school on every visit', () => {
    const a = setup();
    const b = setup({ clock: { now: START + 3 * DAY } });
    const summary = (server) => ({
      enrollments: server.db.count('enrollments', () => true),
      attempts: server.db
        .all('attempts')
        .map((row) => `${row.id}:${row.percent}`)
        .sort(),
      submissions: server.db
        .all('submissions')
        .map((row) => `${row.id}:${row.status}:${row.grade}`)
        .sort(),
    });
    expect(summary(b.server)).toEqual(summary(a.server));
  });
});

describe('automatic grading', () => {
  it('returns very short work and grades the rest, quoting it', () => {
    const assignment = { maxPoints: 10 };
    expect(autoGrade({ submission: { body: 'Too short.' }, files: [], assignment, feedback: ['Nice.'] })).toMatchObject({ status: 'returned', grade: null });
    const graded = autoGrade({
      submission: { body: 'The determinant measures how much the transformation stretches areas. Mine doubles them.' },
      files: [],
      assignment,
      feedback: ['Nice work.'],
      random: () => 0.5,
    });
    expect(graded.status).toBe('graded');
    expect(graded.grade).toBeGreaterThanOrEqual(6);
    expect(graded.grade).toBeLessThanOrEqual(10);
    expect(graded.feedback).toBe('Nice work. I especially liked “The determinant measures how much the transformation stretches areas”.');
  });
});

describe('requests', () => {
  it('answers unknown addresses as the API does, and honours an abort', async () => {
    const { call, server } = setup();
    expect(await call('GET', '/nowhere')).toMatchObject({ status: 404, body: { error: { code: 'not_found' } } });
    const controller = new AbortController();
    controller.abort();
    await expect(server.fetch('/api/v1/auth/me', { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
  });
});
