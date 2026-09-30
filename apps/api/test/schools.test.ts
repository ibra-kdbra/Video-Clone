import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { TestApi, uniqueEmail, uniqueSlug } from './helpers.js';

let api: TestApi;
let owner: postgres.Sql;
beforeAll(async () => {
  api = await TestApi.start();
  owner = postgres(inject('ownerDatabaseUrl'), { max: 1, onnotice: () => {} });
});
afterAll(async () => {
  await api.close();
  await owner.end();
});

/** A school with an owner, an admin, an instructor and a student, all signed in. */
async function schoolWithStaff() {
  const people = {
    owner: await api.signup('Owner'),
    admin: await api.signup('Admin'),
    instructor: await api.signup('Instructor'),
    student: await api.signup('Student'),
  };
  const school = await api.createSchool(people.owner.token);
  for (const role of ['admin', 'instructor', 'student'] as const) {
    const token = await inviteAndGetToken(school.slug, people.owner.token, people[role].email, role);
    const accepted = await api.request('POST', '/invitations/accept', { token: people[role].token, body: { token } });
    expect(accepted.status).toBe(200);
  }
  return { school, ...people };
}

/** Invites someone and reads the link's token from the outbox (what the worker would email). */
async function inviteAndGetToken(slug: string, token: string, email: string, role: string) {
  const response = await api.request('POST', `/schools/${slug}/invitations`, { token, body: { email, role } });
  expect(response.status).toBe(201);
  const [event] = await owner<{ payload: { url: string } }[]>`
    select payload from outbox where type = 'invitation.created' and payload->>'invitationId' = ${response.body.id}`;
  return event!.payload.url.split('#')[1]!;
}

describe('schools', () => {
  it('creates a school with its creator as owner, and shows its public details to anyone', async () => {
    const person = await api.signup();
    const slug = uniqueSlug();
    const created = await api.request('POST', '/schools', { token: person.token, body: { name: '  Riverside Academy ', slug: slug.toUpperCase() } });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ slug, name: 'Riverside Academy', role: 'owner' });

    const publicInfo = await api.request('GET', `/schools/${slug}/public`);
    expect(publicInfo.status).toBe(200);
    expect(publicInfo.body).toEqual({ id: created.body.id, slug, name: 'Riverside Academy', createdAt: created.body.createdAt });
    expect((await api.request('GET', `/schools/${uniqueSlug()}/public`)).status).toBe(404);
  });

  it('refuses taken, reserved and malformed addresses', async () => {
    const person = await api.signup();
    const school = await api.createSchool(person.token);
    const taken = await api.request('POST', '/schools', { token: person.token, body: { name: 'Again', slug: school.slug } });
    expect(taken.status).toBe(409);
    expect(taken.body.error).toMatchObject({ code: 'slug_taken', details: [{ path: 'slug' }] });
    for (const slug of ['admin', 'a', 'has space', '-dash', 'double--dash', 'x'.repeat(41)]) {
      expect((await api.request('POST', '/schools', { token: person.token, body: { name: 'Name', slug } })).status).toBe(400);
    }
  });

  it('limits how many schools one person may own', async () => {
    const person = await api.signup();
    for (let index = 0; index < 3; index++) await api.createSchool(person.token);
    const fourth = await api.request('POST', '/schools', { token: person.token, body: { name: 'Fourth', slug: uniqueSlug() } });
    expect(fourth.status).toBe(403);
    expect(fourth.body.error.code).toBe('limit_reached');
  });

  it('holds the limit even when the requests arrive at the same moment', async () => {
    const person = await api.signup();
    const results = await Promise.all(
      Array.from({ length: 5 }, () => api.request('POST', '/schools', { token: person.token, body: { name: 'Parallel', slug: uniqueSlug() } })),
    );
    expect(results.filter((result) => result.status === 201)).toHaveLength(3);
    expect(results.filter((result) => result.status === 403)).toHaveLength(2);
  });

  it('shows a school only to its members, with their role', async () => {
    const { school, student } = await schoolWithStaff();
    const outsider = await api.signup();
    expect((await api.request('GET', `/schools/${school.slug}`, { token: student.token })).body.role).toBe('student');
    expect((await api.request('GET', `/schools/${school.slug}`, { token: outsider.token })).status).toBe(403);
    expect((await api.request('GET', `/schools/${uniqueSlug()}`, { token: outsider.token })).status).toBe(404);
    expect((await api.request('GET', `/schools/${school.slug}`)).status).toBe(401);
  });
});

describe('members', () => {
  it('lists members to admins, page by page, and to no one below', async () => {
    const { school, owner: first, admin, student, instructor } = await schoolWithStaff();
    const page1 = await api.request('GET', `/schools/${school.slug}/members?limit=3`, { token: admin.token });
    expect(page1.status).toBe(200);
    expect(page1.body.items.map((member: { role: string }) => member.role)).toEqual(['owner', 'admin', 'instructor']);
    const page2 = await api.request('GET', `/schools/${school.slug}/members?limit=3&cursor=${page1.body.nextCursor}`, { token: admin.token });
    expect(page2.body.items.map((member: { userId: string }) => member.userId)).toEqual([student.user.id]);
    expect(page2.body.nextCursor).toBeNull();
    expect(page1.body.items[0].userId).toBe(first.user.id);

    expect((await api.request('GET', `/schools/${school.slug}/members`, { token: instructor.token })).status).toBe(403);
    expect((await api.request('GET', `/schools/${school.slug}/members?cursor=bogus`, { token: admin.token })).status).toBe(400);
    expect((await api.request('GET', `/schools/${school.slug}/members?limit=1000`, { token: admin.token })).status).toBe(400);
  });

  it('lets people manage only the roles below their own', async () => {
    const { school, owner: head, admin, instructor, student } = await schoolWithStaff();
    const change = (token: string, userId: string, role: string) =>
      api.request('PATCH', `/schools/${school.slug}/members/${userId}`, { token, body: { role } });

    expect((await change(admin.token, student.user.id, 'instructor')).status).toBe(200);
    expect((await change(admin.token, student.user.id, 'admin')).status).toBe(403);
    expect((await change(admin.token, head.user.id, 'student')).status).toBe(403);
    expect((await change(admin.token, admin.user.id, 'student')).status).toBe(403);
    expect((await change(instructor.token, student.user.id, 'student')).status).toBe(403);
    expect((await change(head.token, instructor.user.id, 'admin')).body.role).toBe('admin');
    expect((await change(head.token, student.user.id, 'owner')).status).toBe(400);
  });

  it('lets members leave, admins remove those below them, and never removes the owner', async () => {
    const { school, owner: head, admin, instructor, student } = await schoolWithStaff();
    const remove = (token: string, userId: string) => api.request('DELETE', `/schools/${school.slug}/members/${userId}`, { token });

    expect((await remove(student.token, instructor.user.id)).status).toBe(403);
    expect((await remove(admin.token, head.user.id)).status).toBe(403);
    expect((await remove(head.token, head.user.id)).status).toBe(403);
    expect((await remove(admin.token, instructor.user.id)).status).toBe(204);
    expect((await remove(student.token, student.user.id)).status).toBe(204);
    expect((await api.request('GET', `/schools/${school.slug}`, { token: student.token })).status).toBe(403);
    expect((await remove(head.token, admin.user.id)).status).toBe(204);
    expect((await remove(head.token, admin.user.id)).status).toBe(404);
  });
});

describe('invitations', () => {
  it('only lets the owner invite admins', async () => {
    const { school, admin } = await schoolWithStaff();
    const response = await api.request('POST', `/schools/${school.slug}/invitations`, { token: admin.token, body: { email: uniqueEmail(), role: 'admin' } });
    expect(response.status).toBe(403);
  });

  it('replaces an earlier invitation to the same address and refuses current members', async () => {
    const { school, owner: head, student } = await schoolWithStaff();
    const email = uniqueEmail();
    const firstToken = await inviteAndGetToken(school.slug, head.token, email, 'student');
    const secondToken = await inviteAndGetToken(school.slug, head.token, email, 'instructor');
    expect((await api.request('POST', '/invitations/preview', { body: { token: firstToken } })).status).toBe(404);
    expect((await api.request('POST', '/invitations/preview', { body: { token: secondToken } })).body.role).toBe('instructor');

    const open = await api.request('GET', `/schools/${school.slug}/invitations`, { token: head.token });
    expect(open.body.filter((invitation: { email: string }) => invitation.email === email)).toHaveLength(1);

    const member = await api.request('POST', `/schools/${school.slug}/invitations`, { token: head.token, body: { email: student.email, role: 'student' } });
    expect(member.status).toBe(409);
    expect(member.body.error.code).toBe('already_member');
  });

  it('previews without signing in, hiding most of the address', async () => {
    const { school, owner: head } = await schoolWithStaff();
    const token = await inviteAndGetToken(school.slug, head.token, 'jordan.lee@example.com', 'student');
    const preview = await api.request('POST', '/invitations/preview', { body: { token } });
    expect(preview.status).toBe(200);
    expect(preview.body).toMatchObject({ school: { slug: school.slug }, role: 'student', email: 'j******@example.com', invitedBy: 'Owner' });
    expect((await api.request('POST', '/invitations/preview', { body: { token: 'x'.repeat(43) } })).status).toBe(404);
    expect((await api.request('POST', '/invitations/preview', { body: { token: 'short' } })).status).toBe(400);
  });

  it('can only be accepted once, by the invited address, while it is open', async () => {
    const { school, owner: head } = await schoolWithStaff();
    const invited = await api.signup('Invited');
    const other = await api.signup('Other');
    const token = await inviteAndGetToken(school.slug, head.token, invited.email, 'instructor');

    const wrong = await api.request('POST', '/invitations/accept', { token: other.token, body: { token } });
    expect(wrong.status).toBe(403);
    expect(wrong.body.error.code).toBe('invitation_email_mismatch');

    const accepted = await api.request('POST', '/invitations/accept', { token: invited.token, body: { token } });
    expect(accepted.status).toBe(200);
    expect(accepted.body).toMatchObject({ slug: school.slug, role: 'instructor' });
    expect((await api.request('GET', '/auth/me', { token: invited.token })).body.user.emailVerified).toBe(true);
    expect((await api.request('POST', '/invitations/accept', { token: invited.token, body: { token } })).body.error.code).toBe('invitation_invalid');
  });

  it('stops working once cancelled or expired', async () => {
    const { school, owner: head } = await schoolWithStaff();
    const cancelled = await api.signup();
    const cancelledToken = await inviteAndGetToken(school.slug, head.token, cancelled.email, 'student');
    const [invitation] = (await api.request('GET', `/schools/${school.slug}/invitations`, { token: head.token })).body.filter(
      (item: { email: string }) => item.email === cancelled.email,
    );
    expect((await api.request('DELETE', `/schools/${school.slug}/invitations/${invitation.id}`, { token: head.token })).status).toBe(204);
    expect((await api.request('POST', '/invitations/accept', { token: cancelled.token, body: { token: cancelledToken } })).status).toBe(404);

    const late = await api.signup();
    const lateToken = await inviteAndGetToken(school.slug, head.token, late.email, 'student');
    await owner`update invitations set expires_at = now() - interval '1 minute' where email = ${late.email}`;
    expect((await api.request('POST', '/invitations/accept', { token: late.token, body: { token: lateToken } })).status).toBe(404);
  });

  it('records the email in the outbox and every step in the audit log', async () => {
    const { school, owner: head } = await schoolWithStaff();
    const actions = await owner<{ action: string }[]>`select action from audit_log where school_id = ${school.id} order by id`;
    expect(actions.map((row) => row.action)).toEqual([
      'school.created',
      'invitation.created',
      'invitation.accepted',
      'invitation.created',
      'invitation.accepted',
      'invitation.created',
      'invitation.accepted',
    ]);
    const events = await owner<{ type: string }[]>`select type from outbox where school_id = ${school.id} order by id`;
    expect(events.filter((event) => event.type === 'invitation.created')).toHaveLength(3);
    expect(events.filter((event) => event.type === 'member.joined')).toHaveLength(3);
    expect(head.user.id).toBeDefined();
  });
});
