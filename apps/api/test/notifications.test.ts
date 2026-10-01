import postgres from 'postgres';
import type { Socket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest';
import { connected, nextEvent, TestApi, uniqueSlug } from './helpers.js';

let api: TestApi;
let owner: postgres.Sql;
const sockets: Socket[] = [];

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

/** A person with `count` notifications in a school, made a second apart, oldest first. */
async function inbox(count: number) {
  const person = await api.signup('Reader');
  const school = await api.createSchool(person.token, uniqueSlug(), 'Notifying School');
  for (let index = 0; index < count; index++) {
    await owner`
      insert into notifications (user_id, school_id, type, data, created_at)
      values (${person.user.id}, ${school.id}, 'course.published',
              ${owner.json({ title: `Note ${index}`, body: '', path: '/', schoolName: 'Notifying School' })},
              now() - ${`${count - index} seconds`}::interval)`;
  }
  return { person, school };
}

describe('notifications', () => {
  it('lists your notifications newest first, a page at a time, with the unread count', async () => {
    const { person } = await inbox(5);
    const first = await api.request('GET', '/notifications?limit=2', { token: person.token });
    expect(first.body.items.map((item: { data: { title: string } }) => item.data.title)).toEqual(['Note 4', 'Note 3']);
    expect(first.body).toMatchObject({ unread: 5, nextCursor: expect.any(String) });
    const second = await api.request('GET', `/notifications?limit=2&cursor=${first.body.nextCursor}`, { token: person.token });
    expect(second.body.items.map((item: { data: { title: string } }) => item.data.title)).toEqual(['Note 2', 'Note 1']);
    const last = await api.request('GET', `/notifications?limit=2&cursor=${second.body.nextCursor}`, { token: person.token });
    expect(last.body).toMatchObject({ nextCursor: null, items: [expect.objectContaining({ data: expect.objectContaining({ title: 'Note 0' }) })] });
    expect((await api.request('GET', '/notifications?cursor=nonsense', { token: person.token })).status).toBe(400);
  });

  it("marks notifications read, on every device at once, and never touches someone else's", async () => {
    const { person } = await inbox(3);
    const { person: stranger } = await inbox(1);
    const socket = await api.socket(person.token);
    sockets.push(socket);
    await connected(socket);

    const { body: page } = await api.request('GET', '/notifications', { token: person.token });
    const told = nextEvent<{ ids: string[]; unread: number }>(socket, 'notification:read');
    const read = await api.request('POST', '/notifications/read', { token: person.token, body: { ids: [page.items[0].id] } });
    expect(read.body).toEqual({ unread: 2 });
    expect(await told).toEqual({ ids: [page.items[0].id], unread: 2 });
    expect((await api.request('GET', '/notifications?unread=true', { token: person.token })).body.items).toHaveLength(2);

    // Someone else's ids change nothing.
    expect((await api.request('POST', '/notifications/read', { token: stranger.token, body: { ids: page.items.map((item: { id: string }) => item.id) } })).body).toEqual({ unread: 1 });
    expect((await api.request('GET', '/notifications', { token: stranger.token })).body.items).toHaveLength(1);

    expect((await api.request('POST', '/notifications/read', { token: person.token, body: {} })).body).toEqual({ unread: 0 });
    expect((await api.request('GET', '/notifications', { token: person.token })).body.items.every((item: { readAt: string | null }) => item.readAt)).toBe(true);
  });

  it('keeps your choices of what to be told, falling back to the defaults', async () => {
    const person = await api.signup('Chooser');
    const defaults = (await api.request('GET', '/notifications/settings', { token: person.token })).body;
    expect(defaults['assignment.graded']).toEqual({ inApp: true, email: true });
    expect(defaults['course.published']).toEqual({ inApp: true, email: false });

    const changed = await api.request('PUT', '/notifications/settings', { token: person.token, body: { settings: { 'course.published': { inApp: false, email: true } } } });
    expect(changed.body['course.published']).toEqual({ inApp: false, email: true });
    expect(changed.body['assignment.graded']).toEqual({ inApp: true, email: true });
    expect((await api.request('PUT', '/notifications/settings', { token: person.token, body: { settings: { 'made.up': { inApp: true, email: true } } } })).status).toBe(400);
    expect((await api.request('GET', '/notifications/settings', { token: person.token })).body['course.published']).toEqual({ inApp: false, email: true });
  });

  it('needs a signed-in person', async () => {
    expect((await api.request('GET', '/notifications')).status).toBe(401);
  });
});
