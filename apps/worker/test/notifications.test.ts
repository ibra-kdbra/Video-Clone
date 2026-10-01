import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { Notification } from '@grand/contracts';
import { Test } from '@nestjs/testing';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { OutboxProcessor } from '../src/jobs/outbox.processor.js';
import { MailerService } from '../src/mail/mailer.service.js';
import type { Email } from '../src/mail/templates.js';
import { NotificationsService } from '../src/notifications/notifications.service.js';
import { RealtimeEmitter } from '../src/realtime.js';
import { WorkerModule } from '../src/worker.module.js';

const sent: Email[] = [];
const live: { userId: string; event: string; payload: Notification }[] = [];
let owner: postgres.Sql;
let processor: OutboxProcessor;
let notifications: NotificationsService;
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
