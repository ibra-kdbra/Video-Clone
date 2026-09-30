import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { Redis } from 'ioredis';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { MaintenanceService } from '../src/jobs/maintenance.service.js';
import { OutboxProcessor } from '../src/jobs/outbox.processor.js';
import { OutboxRelayService } from '../src/jobs/outbox-relay.service.js';
import { MailerService } from '../src/mail/mailer.service.js';
import type { Email } from '../src/mail/templates.js';
import { WorkerModule } from '../src/worker.module.js';

const sent: Email[] = [];
let owner: postgres.Sql;
let relay: OutboxRelayService;
let processor: OutboxProcessor;
let maintenance: MaintenanceService;
let close: () => Promise<void>;

beforeAll(async () => {
  const redis = new Redis(inject('redisUrl'));
  await redis.flushdb();
  await redis.quit();
  owner = postgres(inject('ownerDatabaseUrl'), { max: 1, onnotice: () => {} });
  const config = loadConfig({ NODE_ENV: 'test', DATABASE_URL: inject('appDatabaseUrl'), REDIS_URL: inject('redisUrl') });
  const moduleRef = await Test.createTestingModule({ imports: [WorkerModule.forRoot(config)] })
    .overrideProvider(MailerService)
    .useValue({ send: async (email: Email) => void sent.push(email) })
    .compile();
  // Only the services under test: no background relay loop or BullMQ workers.
  relay = moduleRef.get(OutboxRelayService);
  processor = moduleRef.get(OutboxProcessor);
  maintenance = moduleRef.get(MaintenanceService);
  close = () => moduleRef.close();
});

afterAll(async () => {
  await close();
  await owner.end();
});

beforeEach(() => {
  sent.length = 0;
});

async function addEvent(type: string, payload: Record<string, unknown>) {
  const [row] = await owner<{ id: string }[]>`insert into outbox (type, payload) values (${type}, ${owner.json(payload as postgres.JSONValue)}) returning id`;
  return Number(row!.id);
}

const invitation = {
  invitationId: '00000000-0000-4000-8000-000000000001',
  email: 'new.teacher@example.com',
  role: 'instructor',
  schoolName: 'Riverside <Academy>',
  inviterName: 'Ada',
  url: 'http://localhost:5173/invite#aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  expiresAt: '2026-10-07T08:00:00.000Z',
};

describe('outbox relay', () => {
  it('queues every unpublished event once, with a job id derived from the event', async () => {
    const first = await addEvent('school.created', { schoolId: 'x' });
    const second = await addEvent('member.joined', { schoolId: 'x' });
    await relay.drain();
    const jobs = await relay.queue.getJobs(['waiting', 'delayed', 'prioritized']);
    expect(jobs.map((job) => job.id).sort()).toEqual(expect.arrayContaining([`outbox-${first}`, `outbox-${second}`]));
    const [counts] = await owner<{ unpublished: number }[]>`select count(*)::int as unpublished from outbox where published_at is null`;
    expect(counts!.unpublished).toBe(0);

    // Publishing the same events again (as after a crash) doesn't duplicate the jobs.
    await owner`update outbox set published_at = null where id in (${first}, ${second})`;
    await relay.drain();
    const again = await relay.queue.getJobs(['waiting', 'delayed', 'prioritized']);
    expect(again.filter((job) => job.id === `outbox-${first}`)).toHaveLength(1);
  });
});

describe('outbox processor', () => {
  it('emails an invitation, then removes the link from the stored event', async () => {
    const id = await addEvent('invitation.created', invitation);
    expect(await processor.process({ data: { outboxId: id } } as never)).toBe('done');
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: 'new.teacher@example.com', subject: 'Ada invited you to Riverside <Academy> on Grand LMS' });
    expect(sent[0]!.text).toContain(invitation.url);
    expect(sent[0]!.html).toContain('Riverside &lt;Academy&gt;');
    expect(sent[0]!.html).not.toContain('<Academy>');

    const [row] = await owner`select payload, processed_at, attempts from outbox where id = ${id}`;
    expect(row!.payload).not.toHaveProperty('url');
    expect(row!.payload.email).toBe('new.teacher@example.com');
    expect(row!.processed_at).not.toBeNull();
    expect(row!.attempts).toBe(1);
  });

  it('skips an event that was already handled, so a retried job sends nothing twice', async () => {
    const id = await addEvent('invitation.created', invitation);
    await processor.process({ data: { outboxId: id } } as never);
    expect(await processor.process({ data: { outboxId: id } } as never)).toBe('skipped');
    expect(sent).toHaveLength(1);
  });

  it('marks events without a handler as done', async () => {
    const id = await addEvent('something.new', {});
    expect(await processor.process({ data: { outboxId: id } } as never)).toBe('done');
  });
});

describe('maintenance', () => {
  it('removes expired tokens, long-ended sessions and old handled events, and nothing else', async () => {
    const [user] = await owner<{ id: string }[]>`
      insert into users (email, name, password_hash) values (${`m-${Date.now()}@example.com`}, 'M', 'x') returning id`;
    const [oldSession, liveSession] = await owner<{ id: string }[]>`
      insert into sessions (user_id, expires_at, revoked_at, revoked_reason) values
        (${user!.id}, now() + interval '1 day', now() - interval '31 days', 'logout'),
        (${user!.id}, now() + interval '1 day', null, null)
      returning id`;
    await owner`insert into refresh_tokens (token_hash, session_id, expires_at) values
      (${Buffer.alloc(32, 1)}, ${liveSession!.id}, now() - interval '8 days'),
      (${Buffer.alloc(32, 2)}, ${liveSession!.id}, now() + interval '1 day')`;
    const oldEvent = await addEvent('school.created', {});
    await owner`update outbox set processed_at = now() - interval '15 days' where id = ${oldEvent}`;

    await maintenance.cleanup();
    expect(await owner`select 1 from sessions where id = ${oldSession!.id}`).toHaveLength(0);
    expect(await owner`select 1 from sessions where id = ${liveSession!.id}`).toHaveLength(1);
    expect(await owner`select 1 from refresh_tokens where session_id = ${liveSession!.id}`).toHaveLength(1);
    expect(await owner`select 1 from outbox where id = ${oldEvent}`).toHaveLength(0);
  });
});
