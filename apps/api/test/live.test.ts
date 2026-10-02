import { decodeJwt } from 'jose';
import { RoomServiceClient } from 'livekit-server-sdk';
import postgres from 'postgres';
import type { Socket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest';
import { acked, as, courseWithPeople, type Person, refused } from './fixtures.js';
import { connected, nextEvent, TestApi } from './helpers.js';

const livekit = inject('livekit');
let api: TestApi;
let owner: postgres.Sql;
const sockets: Socket[] = [];

beforeAll(async () => {
  api = await TestApi.start(livekit ? { LIVEKIT_URL: livekit.url, LIVEKIT_API_KEY: livekit.apiKey, LIVEKIT_API_SECRET: livekit.apiSecret } : {});
  owner = postgres(inject('ownerDatabaseUrl'), { max: 1, onnotice: () => {} });
});
afterEach(() => {
  for (const socket of sockets.splice(0)) socket.close();
});
afterAll(async () => {
  await api.close();
  await owner.end();
});

const inMinutes = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();

async function socketFor(person: Person) {
  const socket = await api.socket(person.token);
  sockets.push(socket);
  await connected(socket);
  return socket;
}

async function scheduled(provider: 'youtube' | 'link' | 'livekit' = 'youtube', startsInMinutes = 60, streamRef: string | null = 'https://youtu.be/aircAruvnKk') {
  const s = await courseWithPeople(api, owner);
  const created = await as(api, s.author).post(`${s.url}/live`, { title: 'Office hours', startsAt: inMinutes(startsInMinutes), durationMinutes: 45, provider, streamRef });
  expect(created.status).toBe(201);
  return { ...s, session: created.body, liveUrl: `${s.url}/live/${created.body.id}` };
}

describe('scheduling', () => {
  it('lets the course’s editors schedule classes, checking what they give', async () => {
    const s = await courseWithPeople(api, owner);
    const create = (person: Person, body: object) => as(api, person).post(`${s.url}/live`, body);
    const base = { title: 'Office hours', startsAt: inMinutes(60), durationMinutes: 60 };

    const youtube = await create(s.author, { ...base, provider: 'youtube', streamRef: 'https://www.youtube.com/watch?v=aircAruvnKk' });
    expect(youtube.body).toMatchObject({ status: 'scheduled', provider: 'youtube', streamRef: 'aircAruvnKk', canHost: true, canJoin: true, host: { name: 'Course Author' }, courseSlug: s.courseSlug });
    expect(new Date(youtube.body.endsAt).getTime() - new Date(youtube.body.startsAt).getTime()).toBe(3_600_000);
    expect(await owner`select 1 from outbox where type = 'live.scheduled' and payload->>'sessionId' = ${youtube.body.id}`).toHaveLength(1);

    expect((await create(s.author, { ...base, provider: 'link', streamRef: null })).body.error.details[0].path).toBe('streamRef');
    expect((await create(s.author, { ...base, provider: 'link', streamRef: 'http://zoom.example/j/1' })).status).toBe(400);
    expect((await create(s.author, { ...base, startsAt: inMinutes(-30), provider: 'youtube' })).body.error.details[0].path).toBe('startsAt');
    if (!livekit) expect((await create(s.author, { ...base, provider: 'livekit' })).body.error.details[0].path).toBe('provider');
    expect((await create(s.student, { ...base, provider: 'youtube' })).status).toBe(403);
    expect((await create(s.colleague, { ...base, provider: 'youtube' })).status).toBe(403);
  });

  it('shows classes to those who can see the course, and their address only to those who may join', async () => {
    const s = await scheduled('link', 60, 'https://meet.example.org/office-hours');
    const forStudent = (await as(api, s.student).get(s.liveUrl)).body;
    // A meeting link waits until it's nearly time.
    expect(forStudent).toMatchObject({ canJoin: true, canHost: false, streamRef: null });
    expect((await as(api, s.author).get(s.liveUrl)).body.streamRef).toBe('https://meet.example.org/office-hours');
    const forOutsider = (await as(api, s.outsider).get(s.liveUrl)).body;
    expect(forOutsider).toMatchObject({ canJoin: false, streamRef: null });

    await as(api, s.author).post(`${s.liveUrl}/start`);
    expect((await as(api, s.student).get(s.liveUrl)).body.streamRef).toBe('https://meet.example.org/office-hours');
    expect((await as(api, s.outsider).get(s.liveUrl)).body.streamRef).toBeNull();

    // The school-wide schedule: classes of courses you take or teach.
    expect((await as(api, s.student).get(`/schools/${s.school.slug}/live`)).body.map((session: { id: string }) => session.id)).toEqual([s.session.id]);
    expect((await as(api, s.outsider).get(`/schools/${s.school.slug}/live`)).body).toEqual([]);
    expect((await as(api, s.head).get(`/schools/${s.school.slug}/live`)).body).toHaveLength(1);
    expect((await as(api, s.student).get(`${s.url}/live?when=upcoming`)).body).toHaveLength(1);
    expect((await as(api, s.student).get(`${s.url}/live?when=past`)).body).toEqual([]);
  });

  it('starts, ends, cancels and removes classes by the rules', async () => {
    const s = await scheduled('youtube', 30, null);
    const post = (path: string) => as(api, s.author).post(`${s.liveUrl}/${path}`);
    // YouTube classes need their stream first.
    expect((await post('start')).body.error.message).toMatch(/YouTube stream/);
    await as(api, s.author).patch(s.liveUrl, { streamRef: 'https://youtu.be/aircAruvnKk' });
    expect((await as(api, s.student).post(`${s.liveUrl}/start`)).status).toBe(403);
    expect((await post('end')).status).toBe(409);
    const live = await post('start');
    expect(live.body).toMatchObject({ status: 'live', startedAt: expect.any(String) });
    expect(await owner`select 1 from outbox where type = 'live.started' and payload->>'sessionId' = ${s.session.id}`).toHaveLength(1);
    expect((await as(api, s.author).patch(s.liveUrl, { startsAt: inMinutes(90) })).status).toBe(409);
    expect((await post('cancel')).status).toBe(409);
    expect((await as(api, s.author).del(s.liveUrl)).status).toBe(409);
    expect((await as(api, s.author).patch(s.liveUrl, { recordingRef: 'https://youtu.be/aircAruvnKk' })).status).toBe(409);

    const ended = await post('end');
    expect(ended.body).toMatchObject({ status: 'ended', endedAt: expect.any(String) });
    expect((await as(api, s.author).patch(s.liveUrl, { recordingRef: 'https://youtu.be/fNk_zzaMoSs' })).body.recordingRef).toBe('fNk_zzaMoSs');
    expect((await as(api, s.student).get(`${s.url}/live?when=past`)).body.map((session: { id: string }) => session.id)).toEqual([s.session.id]);

    // Cancelled, then removed.
    const other = await as(api, s.author).post(`${s.url}/live`, { title: 'Extra class', startsAt: inMinutes(120), durationMinutes: 30, provider: 'youtube' });
    expect((await as(api, s.author).post(`${s.url}/live/${other.body.id}/cancel`)).body.status).toBe('cancelled');
    expect((await as(api, s.author).post(`${s.url}/live/${other.body.id}/start`)).status).toBe(409);
    expect((await as(api, s.author).del(`${s.url}/live/${other.body.id}`)).status).toBe(204);
    expect((await as(api, s.author).get(`${s.url}/live/${other.body.id}`)).status).toBe(404);
  });
});

describe('the class room', () => {
  it('opens the waiting room 15 minutes before, with chat and who is there', async () => {
    const early = await scheduled('youtube', 60);
    const student = await socketFor(early.student);
    expect(refused(await student.emitWithAck('live:join', { sessionId: early.session.id }))).toBe('conflict');
    // Hosts come in whenever they like.
    const host = await socketFor(early.author);
    expect((await host.emitWithAck('live:join', { sessionId: early.session.id })).ok).toBe(true);

    const s = await scheduled('youtube', 10);
    const outsider = await socketFor(s.outsider);
    expect(refused(await outsider.emitWithAck('live:join', { sessionId: s.session.id }))).toBe('enrollment_required');
    expect(refused(await outsider.emitWithAck('live:join', { sessionId: crypto.randomUUID() }))).toBe('not_found');

    const a = await socketFor(s.student);
    const b = await socketFor(s.other);
    const joined = acked(await a.emitWithAck('live:join', { sessionId: s.session.id }));
    expect(joined).toMatchObject({ session: { id: s.session.id, status: 'scheduled' }, messages: [] });
    expect(joined.attendees.map((attendee: { name: string }) => attendee.name)).toEqual(['Student One']);

    const presence = nextEvent<{ attendees: { name: string }[] }>(a, 'live:presence');
    await b.emitWithAck('live:join', { sessionId: s.session.id });
    expect((await presence).attendees.map((attendee) => attendee.name).sort()).toEqual(['Student One', 'Student Two']);

    // Chat, to everyone in the room.
    const heard = nextEvent<{ body: string; author: { name: string } }>(b, 'live:message');
    const sent = await a.emitWithAck('live:message', { sessionId: s.session.id, body: '  Hello, everyone!  ' });
    expect(sent).toMatchObject({ ok: true, data: { body: 'Hello, everyone!', author: { name: 'Student One', host: false }, hidden: false } });
    expect(await heard).toMatchObject({ body: 'Hello, everyone!' });
    expect(refused(await a.emitWithAck('live:message', { sessionId: s.session.id, body: '' }))).toBe('validation_failed');
    // Only in a room you've joined.
    expect(refused(await outsider.emitWithAck('live:message', { sessionId: s.session.id, body: 'Hi' }))).toBe('forbidden');

    // History through the API, too; attendance kept.
    expect((await as(api, s.other).get(`${s.liveUrl}/messages`)).body.map((message: { body: string }) => message.body)).toEqual(['Hello, everyone!']);
    expect((await as(api, s.author).get(`${s.liveUrl}/attendance`)).body.map((row: { name: string }) => row.name).sort()).toEqual(['Student One', 'Student Two']);
    expect((await as(api, s.student).get(`${s.liveUrl}/attendance`)).status).toBe(403);
  });

  it('lets hosts hide messages and students raise hands once the class is on', async () => {
    const s = await scheduled('youtube', 5);
    const host = await socketFor(s.author);
    const student = await socketFor(s.student);
    await host.emitWithAck('live:join', { sessionId: s.session.id });
    await student.emitWithAck('live:join', { sessionId: s.session.id });

    const message = acked(await student.emitWithAck('live:message', { sessionId: s.session.id, body: 'Something rude' }));
    const hidden = nextEvent<{ messageId: string }>(student, 'live:message-hidden');
    expect((await as(api, s.student).post(`${s.liveUrl}/messages/${message.id}/hide`)).status).toBe(403);
    expect((await as(api, s.author).post(`${s.liveUrl}/messages/${message.id}/hide`)).status).toBe(204);
    expect((await hidden).messageId).toBe(message.id);
    expect((await as(api, s.other).get(`${s.liveUrl}/messages`)).body[0]).toMatchObject({ hidden: true, body: '' });
    expect((await as(api, s.author).get(`${s.liveUrl}/messages`)).body[0]).toMatchObject({ hidden: true, body: 'Something rude' });

    expect(refused(await student.emitWithAck('live:hand', { sessionId: s.session.id, raised: true }))).toBe('conflict');
    await as(api, s.author).post(`${s.liveUrl}/start`);
    const raised = nextEvent<{ attendees: { name: string; handRaised: boolean }[] }>(host, 'live:presence');
    expect((await student.emitWithAck('live:hand', { sessionId: s.session.id, raised: true })).ok).toBe(true);
    expect((await raised).attendees.find((attendee) => attendee.name === 'Student One')).toMatchObject({ handRaised: true });
    expect(refused(await host.emitWithAck('live:hand', { sessionId: s.session.id, raised: true }))).toBe('conflict');
    // Hands go up in any class, but only a LiveKit class lets a student speak.
    expect((await as(api, s.author).post(`${s.liveUrl}/speakers/${s.student.user.id}`, { allowed: true })).status).toBe(409);

    // The class ends: everyone hears, and the chat stops.
    const ended = nextEvent<{ status: string }>(student, 'live:status');
    await as(api, s.author).post(`${s.liveUrl}/end`);
    expect((await ended).status).toBe('ended');
    expect(refused(await student.emitWithAck('live:message', { sessionId: s.session.id, body: 'Bye' }))).toBe('conflict');
  });

  it('pages back through the chat without skipping messages sent in the same instant', async () => {
    const s = await scheduled('youtube', 5);
    const at = new Date();
    for (const body of ['one', 'two', 'three']) {
      await owner`insert into live_messages (school_id, session_id, user_id, body, created_at) values (${s.school.id}, ${s.session.id}, ${s.student.user.id}, ${body}, ${at})`;
    }
    const latest = (await as(api, s.other).get(`${s.liveUrl}/messages?limit=2`)).body as { id: string; body: string }[];
    expect(latest).toHaveLength(2);
    const earlier = (await as(api, s.other).get(`${s.liveUrl}/messages?limit=2&before=${latest[0]!.id}`)).body as { body: string }[];
    expect([...earlier, ...latest].map((message) => message.body).sort()).toEqual(['one', 'three', 'two']);
  });

  it('keeps chat to a reasonable pace', async () => {
    const limited = await TestApi.start({ RATE_LIMITS: 'true' });
    try {
      const s = await scheduled('youtube', 5);
      const socket = await limited.socket(s.student.token);
      sockets.push(socket);
      await connected(socket);
      await socket.emitWithAck('live:join', { sessionId: s.session.id });
      const results = [];
      for (let index = 0; index < 10; index++) results.push(await socket.emitWithAck('live:message', { sessionId: s.session.id, body: `Message ${index}` }));
      expect(results.filter((result) => result.ok)).toHaveLength(8);
      expect(results.at(-1)).toMatchObject({ ok: false, error: { code: 'rate_limited' } });
    } finally {
      await limited.close();
    }
  });
});

describe.skipIf(!livekit)('in-browser video (LiveKit)', () => {
  it('signs tokens by role, lets a student speak, and closes the room at the end', async () => {
    const s = await scheduled('livekit', 30, null);
    expect((await as(api, s.student).get(`/schools/${s.school.slug}/live/options`)).body.providers).toContain('livekit');

    // Hosts may connect before going live; students once it's on.
    const hostToken = await as(api, s.author).post(`${s.liveUrl}/token`);
    expect(hostToken.status).toBe(200);
    expect(hostToken.body).toMatchObject({ url: livekit!.url, room: `grand-${s.session.id}`, canPublish: true });
    const hostClaims = decodeJwt(hostToken.body.token) as { sub: string; name: string; video: Record<string, unknown> };
    expect(hostClaims).toMatchObject({ sub: s.author.user.id, name: 'Course Author', video: { room: `grand-${s.session.id}`, roomJoin: true, roomAdmin: true, canPublish: true, canPublishData: false } });
    expect((await as(api, s.student).post(`${s.liveUrl}/token`)).status).toBe(409);
    expect((await as(api, s.outsider).post(`${s.liveUrl}/token`)).status).toBe(403);

    await as(api, s.author).post(`${s.liveUrl}/start`);
    const studentToken = await as(api, s.student).post(`${s.liveUrl}/token`);
    expect(decodeJwt(studentToken.body.token)).toMatchObject({ video: { canPublish: false, canSubscribe: true } });

    // Invited to speak: told live, and their next token can publish.
    const socket = await socketFor(s.student);
    await socket.emitWithAck('live:join', { sessionId: s.session.id });
    const told = nextEvent<{ allowed: boolean }>(socket, 'live:speaker');
    expect((await as(api, s.author).post(`${s.liveUrl}/speakers/${s.student.user.id}`, { allowed: true })).status).toBe(204);
    expect((await told).allowed).toBe(true);
    expect((await as(api, s.student).post(`${s.liveUrl}/token`)).body.canPublish).toBe(true);
    expect((await as(api, s.author).post(`${s.liveUrl}/speakers/${s.outsider.user.id}`, { allowed: true })).status).toBe(404);

    // The room exists on the LiveKit server until the class ends.
    const rooms = new RoomServiceClient(livekit!.url.replace(/^ws/, 'http'), livekit!.apiKey, livekit!.apiSecret);
    await rooms.createRoom({ name: `grand-${s.session.id}` });
    expect((await rooms.listRooms([`grand-${s.session.id}`])).map((room) => room.name)).toEqual([`grand-${s.session.id}`]);
    await as(api, s.author).post(`${s.liveUrl}/end`);
    expect(await rooms.listRooms([`grand-${s.session.id}`])).toEqual([]);
    expect((await as(api, s.student).post(`${s.liveUrl}/token`)).status).toBe(409);
  });
});
