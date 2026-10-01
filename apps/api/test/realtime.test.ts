import { randomUUID } from 'node:crypto';
import type { Socket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest';
import postgres from 'postgres';
import { RealtimeService } from '../src/realtime/realtime.service.js';
import { connected, nextEvent, TestApi, uniqueEmail } from './helpers.js';

let api: TestApi;
let owner: postgres.Sql;
const sockets: Socket[] = [];
const track = <T extends Socket>(socket: T) => (sockets.push(socket), socket);

beforeAll(async () => {
  api = await TestApi.start();
  owner = postgres(inject('ownerDatabaseUrl'), { max: 1, onnotice: () => {} });
});
afterEach(() => {
  for (const socket of sockets.splice(0)) socket.close();
});
afterAll(async () => {
  await api.close();
  await owner.end();
});

describe('connecting', () => {
  it('connects with a fresh ticket, and refuses it the second time', async () => {
    const person = await api.signup();
    const { body } = await api.request('POST', '/realtime/ticket', { token: person.token });
    expect(body.expiresIn).toBe(30);
    await connected(track(api.rawSocket(body.ticket)));
    await expect(connected(track(api.rawSocket(body.ticket)))).rejects.toThrow('unauthenticated');
    await expect(connected(track(api.rawSocket('not-a-ticket')))).rejects.toThrow('unauthenticated');
  });

  it("refuses connections from other sites' pages", async () => {
    const person = await api.signup();
    await expect(connected(track(await api.socket(person.token, 'https://evil.example')))).rejects.toThrow();
  });

  it('needs a signed-in person to issue a ticket', async () => {
    expect((await api.request('POST', '/realtime/ticket')).status).toBe(401);
  });
});

describe('school rooms', () => {
  it("delivers a school's events to members who subscribed, with presence", async () => {
    const head = await api.signup('Head');
    const school = await api.createSchool(head.token);
    const socket = track(await api.socket(head.token));
    await connected(socket);

    const subscribed = await socket.emitWithAck('school:subscribe', { slug: school.slug });
    expect(subscribed).toEqual({ ok: true, data: { schoolId: school.id, online: [head.user.id] } });

    const newcomer = await api.signup('Newcomer', uniqueEmail());
    await api.request('POST', `/schools/${school.slug}/invitations`, { token: head.token, body: { email: newcomer.email, role: 'student' } });
    const [event] = await owner<{ payload: { url: string } }[]>`
      select payload from outbox where type = 'invitation.created' and payload->>'email' = ${newcomer.email}`;
    const joined = nextEvent<{ schoolId: string; member: { userId: string; role: string } }>(socket, 'school:member-joined');
    await api.request('POST', '/invitations/accept', { token: newcomer.token, body: { token: event!.payload.url.split('#')[1] } });
    expect(await joined).toMatchObject({ schoolId: school.id, member: { userId: newcomer.user.id, role: 'student' } });

    const other = track(await api.socket(newcomer.token));
    await connected(other);
    const presence = nextEvent<{ online: string[] }>(socket, 'school:presence');
    await other.emitWithAck('school:subscribe', { slug: school.slug });
    expect((await presence).online.sort()).toEqual([head.user.id, newcomer.user.id].sort());

    const left = nextEvent<{ online: string[] }>(socket, 'school:presence');
    other.close();
    expect((await left).online).toEqual([head.user.id]);
  });

  it('refuses subscriptions to schools you are not in', async () => {
    const head = await api.signup();
    const school = await api.createSchool(head.token);
    const outsider = await api.signup();
    const socket = track(await api.socket(outsider.token));
    await connected(socket);
    const answer = await socket.emitWithAck('school:subscribe', { slug: school.slug });
    expect(answer).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(await socket.emitWithAck('school:subscribe', { slug: 'NOT A SLUG' })).toMatchObject({ ok: false });
  });
});

describe('sessions', () => {
  it('disconnects a device the moment it is signed out elsewhere', async () => {
    const person = await api.signup();
    const socket = track(await api.socket(person.token));
    await connected(socket);
    const [session] = (await api.request('GET', '/auth/sessions', { token: person.token })).body;
    const revoked = nextEvent<{ reason: string }>(socket, 'session:revoked');
    const disconnected = nextEvent<string>(socket, 'disconnect');
    await api.request('DELETE', `/auth/sessions/${session.id}`, { token: person.token });
    expect(await revoked).toEqual({ reason: 'revoked' });
    expect(await disconnected).toBe('io server disconnect');
  });

  it('refuses a ticket once its session has ended', async () => {
    const person = await api.signup();
    const { body } = await api.request('POST', '/realtime/ticket', { token: person.token });
    await api.request('POST', '/auth/logout', { cookie: person.cookie, headers: { origin: 'http://localhost:5173' } });
    await expect(connected(track(api.rawSocket(body.ticket)))).rejects.toThrow('unauthenticated');
  });
});

describe('ordering', () => {
  it('applies a quick unsubscribe and resubscribe in the order they were sent', async () => {
    const head = await api.signup();
    const school = await api.createSchool(head.token);
    const socket = track(await api.socket(head.token));
    await connected(socket);
    await socket.emitWithAck('school:subscribe', { slug: school.slug });
    const [left, joined] = await Promise.all([
      socket.emitWithAck('school:unsubscribe', { slug: school.slug }),
      socket.emitWithAck('school:subscribe', { slug: school.slug }),
    ]);
    expect(left).toEqual({ ok: true, data: undefined });
    expect(joined).toMatchObject({ ok: true, data: { online: [head.user.id] } });

    // Still in the room: school events keep arriving.
    const newcomer = await api.signup();
    const arrived = nextEvent<{ member: { userId: string } }>(socket, 'school:member-joined');
    await api.request('POST', `/schools/${school.slug}/invitations`, { token: head.token, body: { email: newcomer.email, role: 'student' } });
    const [event] = await owner<{ payload: { url: string } }[]>`
      select payload from outbox where type = 'invitation.created' and payload->>'email' = ${newcomer.email}`;
    await api.request('POST', '/invitations/accept', { token: newcomer.token, body: { token: event!.payload.url.split('#')[1] } });
    expect((await arrived).member.userId).toBe(newcomer.user.id);
  });

  it('tells a removed member before taking them out of the room', async () => {
    const head = await api.signup();
    const school = await api.createSchool(head.token);
    const member = await api.signup();
    await api.request('POST', `/schools/${school.slug}/invitations`, { token: head.token, body: { email: member.email, role: 'student' } });
    const [event] = await owner<{ payload: { url: string } }[]>`
      select payload from outbox where type = 'invitation.created' and payload->>'email' = ${member.email}`;
    await api.request('POST', '/invitations/accept', { token: member.token, body: { token: event!.payload.url.split('#')[1] } });

    const socket = track(await api.socket(member.token));
    await connected(socket);
    await socket.emitWithAck('school:subscribe', { slug: school.slug });
    const removed = nextEvent<{ userId: string }>(socket, 'school:member-removed');
    await api.request('DELETE', `/schools/${school.slug}/members/${member.user.id}`, { token: head.token });
    expect(await removed).toEqual({ schoolId: school.id, userId: member.user.id });
  });

  it('sends video progress to staff only, following role changes', async () => {
    const head = await api.signup();
    const school = await api.createSchool(head.token);
    const member = await api.signup();
    await api.request('POST', `/schools/${school.slug}/invitations`, { token: head.token, body: { email: member.email, role: 'student' } });
    const [event] = await owner<{ payload: { url: string } }[]>`
      select payload from outbox where type = 'invitation.created' and payload->>'email' = ${member.email}`;
    await api.request('POST', '/invitations/accept', { token: member.token, body: { token: event!.payload.url.split('#')[1] } });

    const staff = track(await api.socket(head.token));
    const student = track(await api.socket(member.token));
    await Promise.all([connected(staff), connected(student)]);
    await staff.emitWithAck('school:subscribe', { slug: school.slug });
    await student.emitWithAck('school:subscribe', { slug: school.slug });
    const heard: number[] = [];
    student.on('media:updated', (update: { progress: number }) => heard.push(update.progress));

    const realtime = api.app.get(RealtimeService);
    const send = (progress: number) =>
      realtime.emitToSchoolStaff(school.id, 'media:updated', {
        schoolId: school.id, assetId: randomUUID(), lessonId: null, status: 'processing', progress, error: null, durationSeconds: null,
      });
    const role = (value: string) => api.request('PATCH', `/schools/${school.slug}/members/${member.user.id}`, { token: head.token, body: { role: value } });

    let next = nextEvent<{ progress: number }>(staff, 'media:updated');
    send(10);
    expect(await next).toMatchObject({ progress: 10 });

    await role('instructor');
    next = nextEvent<{ progress: number }>(student, 'media:updated');
    send(20);
    expect(await next).toMatchObject({ progress: 20 });

    await role('student');
    next = nextEvent<{ progress: number }>(staff, 'media:updated');
    send(30);
    await next;
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(heard).toEqual([20]);
  });
});
