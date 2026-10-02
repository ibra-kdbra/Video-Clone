import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { Notification } from '@grand/contracts';
import { Test } from '@nestjs/testing';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { MaintenanceService } from '../src/jobs/maintenance.service.js';
import { OutboxProcessor } from '../src/jobs/outbox.processor.js';
import { MailerService } from '../src/mail/mailer.service.js';
import type { Email } from '../src/mail/templates.js';
import { formatWhen, NotificationsService } from '../src/notifications/notifications.service.js';
import { RealtimeEmitter } from '../src/realtime.js';
import { WorkerModule } from '../src/worker.module.js';

const sent: Email[] = [];
const live: { userId: string; event: string; payload: Notification }[] = [];
let owner: postgres.Sql;
let processor: OutboxProcessor;
let notifications: NotificationsService;
let maintenance: MaintenanceService;
let close: () => Promise<void>;

beforeAll(async () => {
  owner = postgres(inject('ownerDatabaseUrl'), { max: 1, onnotice: () => {} });
  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: inject('appDatabaseUrl'),
    REDIS_URL: inject('redisUrl'),
    PUBLIC_WEB_URL: 'https://lms.example/',
    MAIL_RATE_PER_SECOND: '100',
  });
  const moduleRef = await Test.createTestingModule({ imports: [WorkerModule.forRoot(config)] })
    .overrideProvider(MailerService)
    .useValue({ send: async (email: Email) => void sent.push(email) })
    .overrideProvider(RealtimeEmitter)
    .useValue({ media: () => {}, toUser: (userId: string, event: string, payload: Notification) => void live.push({ userId, event, payload }) })
    .compile();
  processor = moduleRef.get(OutboxProcessor);
  notifications = moduleRef.get(NotificationsService);
  maintenance = moduleRef.get(MaintenanceService);
  close = () => moduleRef.close();
});

afterAll(async () => {
  await close();
  await owner.end();
});

beforeEach(() => {
  sent.length = 0;
  live.length = 0;
});

/** A school with a course author, two enrolled students and a member who isn't enrolled. */
async function school() {
  const person = async (name: string, settings: Record<string, unknown> = {}) => {
    const [row] = await owner<{ id: string }[]>`
      insert into users (email, name, password_hash, notification_settings)
      values (${`${name.toLowerCase()}-${randomUUID().slice(0, 8)}@example.com`}, ${name}, 'x', ${owner.json(settings as postgres.JSONValue)}) returning id`;
    return row!.id;
  };
  const head = await person('Head');
  const author = await person('Author');
  const student = await person('Student', { 'assignment.graded': { inApp: true, email: true }, 'lesson.published': { inApp: true, email: true } });
  const quiet = await person('Quiet', { 'lesson.published': { inApp: false, email: false } });
  const lurker = await person('Lurker');
  const [created] = await owner<{ id: string; slug: string }[]>`
    insert into schools (slug, name, created_by) values (${`notify-${randomUUID().slice(0, 8)}`}, 'Riverside', ${head}) returning id, slug`;
  const schoolId = created!.id;
  for (const [id, role] of [[head, 'owner'], [author, 'instructor'], [student, 'student'], [quiet, 'student'], [lurker, 'student']]) {
    await owner`insert into memberships (school_id, user_id, role) values (${schoolId}, ${id!}, ${role!})`;
  }
  const [course] = await owner<{ id: string }[]>`
    insert into courses (school_id, slug, title, summary, status, created_by)
    values (${schoolId}, 'piano', 'Piano Foundations', 'Learn the piano.', 'published', ${author}) returning id`;
  const [module] = await owner<{ id: string }[]>`insert into course_modules (school_id, course_id, title, position) values (${schoolId}, ${course!.id}, 'M', 0) returning id`;
  const [lesson] = await owner<{ id: string }[]>`
    insert into lessons (school_id, course_id, module_id, kind, title, summary, status, position)
    values (${schoolId}, ${course!.id}, ${module!.id}, 'assignment', 'Play a scale', 'Record yourself.', 'published', 0) returning id`;
  for (const id of [student, quiet]) await owner`insert into enrollments (school_id, course_id, user_id) values (${schoolId}, ${course!.id}, ${id})`;
  return { schoolId, slug: created!.slug, head, author, student, quiet, lurker, courseId: course!.id, lessonId: lesson!.id };
}

async function handle(type: string, schoolId: string, payload: Record<string, unknown>) {
  const [row] = await owner<{ id: string }[]>`
    insert into outbox (type, school_id, payload) values (${type}, ${schoolId}, ${owner.json(payload as postgres.JSONValue)}) returning id`;
  await processor.process({ data: { outboxId: Number(row!.id) } } as never);
  return Number(row!.id);
}

const inbox = (userId: string) => owner<{ type: string; data: { title: string; body: string; path: string } }[]>`select type, data from notifications where user_id = ${userId} order by created_at`;

describe('notifications', () => {
  it('tells everyone in the school but the publisher about a new course, live', async () => {
    const s = await school();
    await handle('course.published', s.schoolId, { courseId: s.courseId, schoolId: s.schoolId, actorId: s.author });
    expect(await inbox(s.author)).toEqual([]);
    for (const id of [s.head, s.student, s.quiet, s.lurker]) {
      expect(await inbox(id)).toEqual([{ type: 'course.published', data: { title: 'New course: Piano Foundations', body: 'Learn the piano.', path: `/s/${s.slug}/c/piano`, schoolName: 'Riverside' } }]);
    }
    expect(live.map((entry) => entry.userId).sort()).toEqual([s.head, s.student, s.quiet, s.lurker].sort());
    expect(live[0]).toMatchObject({ event: 'notification:new', payload: { type: 'course.published', schoolId: s.schoolId, readAt: null } });
    // Nobody asked for course emails (the default is off).
    expect(sent).toEqual([]);
  });

  it('tells enrolled students about a new lesson, as each of them chose, once even if the event repeats', async () => {
    const s = await school();
    const id = await handle('lesson.published', s.schoolId, { lessonId: s.lessonId, courseId: s.courseId, actorId: s.author });
    expect(await inbox(s.student)).toHaveLength(1);
    expect(await inbox(s.quiet)).toEqual([]);
    expect(await inbox(s.lurker)).toEqual([]);
    expect(sent.map((email) => email.to)).toEqual([expect.stringMatching(/^student-/)]);
    expect(sent[0]!.subject).toBe('New in Piano Foundations: Play a scale · Riverside');
    expect(sent[0]!.text).toContain(`Open it: https://lms.example/s/${s.slug}/c/piano/l/${s.lessonId}`);

    // The same event handled again (a retry after a crash) writes and sends nothing new.
    await owner`update outbox set processed_at = null where id = ${id}`;
    await processor.process({ data: { outboxId: id } } as never);
    expect(await inbox(s.student)).toHaveLength(1);
    expect(sent).toHaveLength(1);
  });

  it("tells the course's author about a submission, and the student about their grade", async () => {
    const s = await school();
    const submissionId = randomUUID();
    await handle('assignment.submitted', s.schoolId, { submissionId, lessonId: s.lessonId, courseId: s.courseId, studentId: s.student });
    expect(await inbox(s.author)).toEqual([
      expect.objectContaining({ data: expect.objectContaining({ title: 'Student handed in Play a scale', path: `/s/${s.slug}/c/piano/l/${s.lessonId}/submissions/${submissionId}` }) }),
    ]);
    expect(await inbox(s.head)).toEqual([]);

    await handle('assignment.graded', s.schoolId, { submissionId, lessonId: s.lessonId, courseId: s.courseId, studentId: s.student, status: 'graded', grade: 92.5, maxPoints: 100 });
    expect((await inbox(s.student)).map((row) => row.data.title)).toEqual(['Play a scale was graded: 92.5/100']);
    expect(sent.map((email) => email.subject)).toEqual(['Play a scale was graded: 92.5/100 · Riverside']);
    expect(sent[0]!.html).toContain('https://lms.example/account/notifications');
  });

  it("falls back to the school's admins when the course's author is gone", async () => {
    const s = await school();
    await owner`delete from memberships where school_id = ${s.schoolId} and user_id = ${s.author}`;
    await handle('assignment.submitted', s.schoolId, { submissionId: randomUUID(), lessonId: s.lessonId, courseId: s.courseId, studentId: s.student });
    expect(await inbox(s.head)).toHaveLength(1);
  });

  it('emails someone who turned in-app notifications off but email on', async () => {
    const s = await school();
    await owner`update users set notification_settings = ${owner.json({ 'course.published': { inApp: false, email: true } })} where id = ${s.lurker}`;
    await handle('course.published', s.schoolId, { courseId: s.courseId, schoolId: s.schoolId, actorId: s.author });
    expect(await inbox(s.lurker)).toEqual([]);
    expect(sent.map((email) => email.to)).toEqual([expect.stringMatching(/^lurker-/)]);
  });

  it('tells an uploader their video is ready', async () => {
    const s = await school();
    await notifications.videoProcessed({ schoolId: s.schoolId, assetId: randomUUID(), lessonId: s.lessonId, uploadedBy: s.author, ready: true });
    expect((await inbox(s.author)).map((row) => row.data)).toEqual([
      { title: 'Your video for Play a scale is ready', body: 'Piano Foundations', path: `/s/${s.slug}/c/piano/edit?lesson=${s.lessonId}`, schoolName: 'Riverside' },
    ]);
  });
});

/** A post as the API writes it: a thread (with a title), a lesson comment, or a reply. */
async function post(s: Awaited<ReturnType<typeof school>>, fields: { authorId: string; body: string; title?: string; lessonId?: string; parentId?: string; status?: string }) {
  const [row] = await owner<{ id: string }[]>`
    insert into discussion_posts (school_id, course_id, lesson_id, parent_id, author_id, title, body, status)
    values (${s.schoolId}, ${s.courseId}, ${fields.lessonId ?? null}, ${fields.parentId ?? null}, ${fields.authorId}, ${fields.title ?? null}, ${fields.body}, ${fields.status ?? 'visible'})
    returning id`;
  return row!.id;
}

/** A LiveKit class in the piano course, hosted by its author. */
async function liveClass(s: Awaited<ReturnType<typeof school>>, title: string, startsAt: Date, extra: { status?: string; startedAt?: Date | null; durationMinutes?: number } = {}) {
  const [row] = await owner<{ id: string }[]>`
    insert into live_sessions (school_id, course_id, title, starts_at, duration_minutes, provider, status, started_at, created_by)
    values (${s.schoolId}, ${s.courseId}, ${title}, ${startsAt}, ${extra.durationMinutes ?? 60}, 'livekit', ${extra.status ?? 'scheduled'}, ${extra.startedAt ?? null}, ${s.author})
    returning id`;
  return row!.id;
}

const minutesFromNow = (minutes: number) => new Date(Date.now() + minutes * 60_000);

describe('discussions and live classes', () => {
  it("tells the course's author about new threads and lesson comments, and an author about replies to them", async () => {
    const s = await school();
    const thread = await post(s, { authorId: s.student, title: 'Which finger crosses under?', body: 'After E,\n\nor after F?' });
    await handle('discussion.posted', s.schoolId, { postId: thread, courseId: s.courseId, lessonId: null, actorId: s.student });
    expect((await inbox(s.author)).map((row) => row.data)).toEqual([
      { title: 'Student started a thread: Which finger crosses under?', body: 'After E, or after F?', path: `/s/${s.slug}/c/piano/discussions/${thread}`, schoolName: 'Riverside' },
    ]);
    for (const id of [s.head, s.student, s.quiet, s.lurker]) expect(await inbox(id)).toEqual([]);

    const comment = await post(s, { authorId: s.quiet, lessonId: s.lessonId, body: 'My left hand keeps rushing.' });
    await handle('discussion.posted', s.schoolId, { postId: comment, courseId: s.courseId, lessonId: s.lessonId, actorId: s.quiet });
    expect((await inbox(s.author)).at(-1)).toMatchObject({
      type: 'discussion.posted',
      data: { title: 'Quiet commented on Play a scale', path: `/s/${s.slug}/c/piano/l/${s.lessonId}?comment=${comment}` },
    });

    // The author answers: the student hears about it, with the start of the reply.
    const reply = await post(s, { authorId: s.author, parentId: thread, body: `Thumb under after E. ${'Slowly, and with a metronome. '.repeat(8)}` });
    await handle('discussion.replied', s.schoolId, { postId: reply, parentId: thread, courseId: s.courseId, actorId: s.author });
    const [heard] = await inbox(s.student);
    expect(heard).toMatchObject({ type: 'discussion.reply', data: { title: 'Author replied in “Which finger crosses under?”', path: `/s/${s.slug}/c/piano/discussions/${thread}` } });
    expect(heard!.data.body).toMatch(/^Thumb under after E\. Slowly/);
    expect(heard!.data.body.length).toBeLessThanOrEqual(140);
    expect(heard!.data.body.endsWith('…')).toBe(true);

    // A reply on a lesson comment points at the lesson.
    const answer = await post(s, { authorId: s.student, parentId: comment, body: 'Same here!' });
    await handle('discussion.replied', s.schoolId, { postId: answer, parentId: comment, courseId: s.courseId, actorId: s.student });
    expect((await inbox(s.quiet)).map((row) => row.data.title)).toEqual(['Student replied to your comment on Play a scale']);

    // Nobody hears about their own reply, or one hidden before the event was handled.
    const own = await post(s, { authorId: s.student, parentId: thread, body: 'Thanks!' });
    await handle('discussion.replied', s.schoolId, { postId: own, parentId: thread, courseId: s.courseId, actorId: s.student });
    const hidden = await post(s, { authorId: s.lurker, parentId: thread, body: 'Buy my course instead', status: 'hidden' });
    await handle('discussion.replied', s.schoolId, { postId: hidden, parentId: thread, courseId: s.courseId, actorId: s.lurker });
    expect(await inbox(s.student)).toHaveLength(1);
    // Nobody asked for discussion emails (the default is off).
    expect(sent).toEqual([]);
  });

  it("asks the course's author to look at a report, unless it was dealt with first", async () => {
    const s = await school();
    const thread = await post(s, { authorId: s.lurker, title: 'Cheap pianos here', body: 'Visit my shop' });
    const report = async (reporterId: string, resolved: boolean) => {
      const [row] = await owner<{ id: string }[]>`
        insert into discussion_reports (school_id, course_id, post_id, reporter_id, reason, resolved_at, resolved_by, resolution)
        values (${s.schoolId}, ${s.courseId}, ${thread}, ${reporterId}, 'spam', ${resolved ? new Date() : null}, ${resolved ? s.author : null}, ${resolved ? 'dismissed' : null})
        returning id`;
      return row!.id;
    };
    await handle('discussion.reported', s.schoolId, { reportId: await report(s.student, false), postId: thread, courseId: s.courseId, actorId: s.student });
    expect((await inbox(s.author)).map((row) => row.data)).toEqual([
      { title: 'A post was reported in Piano Foundations', body: 'Reason: spam. Have a look in the moderation queue.', path: `/s/${s.slug}/c/piano/discussions/reports`, schoolName: 'Riverside' },
    ]);
    // Reports are worth an email by default.
    expect(sent.map((email) => email.to)).toEqual([expect.stringMatching(/^author-/)]);

    await handle('discussion.reported', s.schoolId, { reportId: await report(s.quiet, true), postId: thread, courseId: s.courseId, actorId: s.quiet });
    expect(await inbox(s.author)).toHaveLength(1);
  });

  it('tells enrolled students when a class is scheduled and when it starts, not after it was cancelled', async () => {
    const s = await school();
    const startsAt = new Date('2031-03-04T17:30:00Z');
    const id = await liveClass(s, 'Scales clinic', startsAt);
    await handle('live.scheduled', s.schoolId, { sessionId: id, courseId: s.courseId, actorId: s.author });
    for (const person of [s.student, s.quiet]) {
      expect((await inbox(person)).map((row) => row.data)).toEqual([
        { title: 'Live class: Scales clinic', body: 'Piano Foundations · Tue 4 Mar, 17:30 UTC', path: `/s/${s.slug}/c/piano/live/${id}`, schoolName: 'Riverside' },
      ]);
    }
    expect(formatWhen(startsAt)).toBe('Tue 4 Mar, 17:30 UTC');
    for (const person of [s.author, s.head, s.lurker]) expect(await inbox(person)).toEqual([]);

    await owner`update live_sessions set status = 'live', started_at = now() where id = ${id}`;
    await handle('live.started', s.schoolId, { sessionId: id, courseId: s.courseId, actorId: s.author });
    expect((await inbox(s.student)).map((row) => row.data.title)).toEqual(['Live class: Scales clinic', 'Live now: Scales clinic']);

    // An event handled after the class was cancelled tells nobody.
    const cancelled = await liveClass(s, 'Arpeggios', startsAt, { status: 'cancelled' });
    await handle('live.scheduled', s.schoolId, { sessionId: cancelled, courseId: s.courseId, actorId: s.author });
    expect(await inbox(s.student)).toHaveLength(2);
  });

  it('reminds students and the host shortly before a class, once, and tidies up classes left behind', async () => {
    const s = await school();
    const soon = await liveClass(s, 'Office hours', minutesFromNow(10.5));
    const later = await liveClass(s, 'Recital prep', minutesFromNow(120));
    const forgotten = await liveClass(s, 'Left running', minutesFromNow(-300), { status: 'live', startedAt: minutesFromNow(-300) });
    const ghost = await liveClass(s, 'Never started', minutesFromNow(-240));
    const running = await liveClass(s, 'Going well', minutesFromNow(-30), { status: 'live', startedAt: minutesFromNow(-30) });

    const first = await maintenance.liveClasses();
    expect(first.reminded).toBeGreaterThanOrEqual(1);
    expect(first.closed).toBeGreaterThanOrEqual(2);
    for (const person of [s.student, s.quiet, s.author]) {
      expect(await inbox(person)).toEqual([
        { type: 'live.reminder', data: { title: 'Starting in 10 minutes: Office hours', body: 'Piano Foundations. The waiting room is open.', path: `/s/${s.slug}/c/piano/live/${soon}`, schoolName: 'Riverside' } },
      ]);
    }
    expect(await inbox(s.lurker)).toEqual([]);
    // Reminders are worth an email by default; Quiet only turned off lesson emails.
    expect(sent.map((email) => email.to.split('-')[0]).sort()).toEqual(['author', 'quiet', 'student']);

    const states = await owner<{ id: string; status: string; reminded: boolean; ended: boolean }[]>`
      select id, status::text, reminded_at is not null as reminded, ended_at is not null as ended from live_sessions where school_id = ${s.schoolId}`;
    const state = Object.fromEntries(states.map((row) => [row.id, row]));
    expect(state[soon]).toMatchObject({ status: 'scheduled', reminded: true });
    expect(state[later]).toMatchObject({ status: 'scheduled', reminded: false });
    expect(state[forgotten]).toMatchObject({ status: 'ended', ended: true });
    expect(state[ghost]).toMatchObject({ status: 'cancelled' });
    expect(state[running]).toMatchObject({ status: 'live' });

    // A minute later: nothing new.
    await maintenance.liveClasses();
    expect(await inbox(s.student)).toHaveLength(1);
    expect(sent).toHaveLength(3);
  });
});
