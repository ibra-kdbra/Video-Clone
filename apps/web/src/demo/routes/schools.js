import { ROLE_RANK, acceptInvitationInput, createInvitationInput, createSchoolInput, listQuery, schoolSlug, updateMemberInput, uuid } from '@grand/contracts';

import { HttpError, badRequest, forbidden, notFound } from '../http.js';
import { hash128, randomId, randomToken } from '../ids.js';
import { iso, maskEmail, outranks } from '../logic.js';
import { toPublicSchool } from './auth.js';

/**
 * Schools, members and invitations (apps/api/src/schools). Invitations work as on the server,
 * except that no email goes out, so a link can't actually reach anyone in the demo.
 */

const MAX_SCHOOLS_PER_OWNER = 3;
const INVITATION_TTL_MS = 7 * 86_400_000;
const QUOTA_BYTES = 2 * 1024 ** 3;

const invalidInvitation = () => new HttpError(404, 'invitation_invalid', 'This invitation has expired or was already used. Ask for a new one.');

const encodeCursor = (values) => btoa(JSON.stringify(values)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function decodeCursor(cursor) {
  try {
    const values = JSON.parse(atob(cursor.replace(/-/g, '+').replace(/_/g, '/')));
    if (Array.isArray(values) && values.length === 2 && Number.isFinite(values[0]) && typeof values[1] === 'string') return values;
  } catch {
    // Falls through.
  }
  throw badRequest('This page link is no longer valid.');
}

const toMember = (db, membership) => {
  const user = db.get('users', membership.userId);
  return { userId: membership.userId, name: user.name, email: user.email, role: membership.role, joinedAt: iso(membership.createdAt) };
};

function toInvitation(db, row) {
  const inviter = row.invitedBy ? db.get('users', row.invitedBy) : null;
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    invitedBy: inviter ? { id: inviter.id, name: inviter.name } : null,
    createdAt: iso(row.createdAt),
    expiresAt: iso(row.expiresAt),
  };
}

/** Everything of a member's in a school goes with their membership (the database's cascades). */
export function removeMembership(db, schoolId, userId) {
  const submissions = new Set(db.filter('submissions', (row) => row.schoolId === schoolId && row.userId === userId).map((row) => row.id));
  db.removeWhere('files', (row) => submissions.has(row.submissionId));
  db.removeWhere('submissions', (row) => submissions.has(row.id));
  for (const table of ['enrollments', 'progress', 'attempts', 'notifications']) db.removeWhere(table, (row) => row.schoolId === schoolId && row.userId === userId);
  db.remove('memberships', `${schoolId}:${userId}`);
}

export function register(router, server) {
  router.add('POST', '/schools', { body: createSchoolInput, status: 201 }, (ctx) => {
    const { db, auth, body } = ctx;
    const owned = db.count('memberships', (row) => row.userId === auth.userId && row.role === 'owner');
    if (owned >= MAX_SCHOOLS_PER_OWNER) throw new HttpError(403, 'limit_reached', `You can own up to ${MAX_SCHOOLS_PER_OWNER} schools.`);
    if (db.find('schools', (row) => row.slug === body.slug)) {
      throw new HttpError(409, 'slug_taken', 'This address is taken. Try another one.', [{ path: 'slug', message: 'This address is taken' }]);
    }
    const school = db.put('schools', { id: randomId(), slug: body.slug, name: body.name, description: '', createdAt: ctx.now, createdBy: auth.userId });
    db.put('memberships', { id: `${school.id}:${auth.userId}`, schoolId: school.id, userId: auth.userId, role: 'owner', createdAt: ctx.now });
    db.put('storage', { id: school.id, quotaBytes: QUOTA_BYTES, usedBytes: 0, reservedBytes: 0 });
    return { ...toPublicSchool(school), role: 'owner' };
  });

  router.add('GET', '/schools/:slug/public', { public: true, params: { slug: schoolSlug } }, (ctx) => {
    const school = ctx.db.find('schools', (row) => row.slug === ctx.params.slug);
    if (!school) throw notFound('This school');
    return toPublicSchool(school);
  });

  router.add('GET', '/schools/:slug', { school: 'student' }, (ctx) => ({ ...toPublicSchool(ctx.db.get('schools', ctx.school.id)), role: ctx.school.role }));

  router.add('GET', '/schools/:slug/members', { school: 'admin', query: listQuery }, (ctx) => {
    const { db, school, query } = ctx;
    const after = query.cursor ? decodeCursor(query.cursor) : null;
    const rows = db
      .filter('memberships', (row) => row.schoolId === school.id)
      .sort((a, b) => a.createdAt - b.createdAt || (a.userId < b.userId ? -1 : 1))
      .filter((row) => !after || row.createdAt > after[0] || (row.createdAt === after[0] && row.userId > after[1]));
    const page = rows.slice(0, query.limit);
    const last = rows.length > query.limit ? page.at(-1) : null;
    return { items: page.map((row) => toMember(db, row)), nextCursor: last ? encodeCursor([last.createdAt, last.userId]) : null };
  });

  router.add('PATCH', '/schools/:slug/members/:userId', { school: 'admin', params: { userId: uuid }, body: updateMemberInput }, (ctx) => {
    const { db, school, auth, params, body } = ctx;
    if (params.userId === auth.userId) throw forbidden("You can't change your own role.");
    const current = db.get('memberships', `${school.id}:${params.userId}`);
    if (!current) throw notFound('This member');
    if (!outranks(school.role, current.role) || !outranks(school.role, body.role)) {
      throw forbidden(school.role === 'admin' ? 'Only the owner can manage admins.' : "You can't manage this member.");
    }
    const updated = db.update('memberships', current.id, { role: body.role });
    server.emitToSchool(school.id, 'school:member-updated', { schoolId: school.id, userId: params.userId, role: body.role });
    return toMember(db, updated);
  });

  router.add('DELETE', '/schools/:slug/members/:userId', { school: 'student', params: { userId: uuid } }, (ctx) => {
    const { db, school, auth, params } = ctx;
    const leaving = params.userId === auth.userId;
    const current = db.get('memberships', `${school.id}:${params.userId}`);
    if (!current) throw notFound('This member');
    if (current.role === 'owner') throw forbidden(leaving ? 'The owner can’t leave their own school.' : 'The owner can’t be removed.');
    if (!leaving && (ROLE_RANK[school.role] < ROLE_RANK.admin || !outranks(school.role, current.role))) throw forbidden("You can't remove this member.");
    server.emitToSchool(school.id, 'school:member-removed', { schoolId: school.id, userId: params.userId });
    removeMembership(db, school.id, params.userId);
  });

  // Invitations ------------------------------------------------------------------------------------

  router.add('POST', '/schools/:slug/invitations', { school: 'admin', body: createInvitationInput, status: 201 }, (ctx) => {
    const { db, school, auth, body } = ctx;
    if (!outranks(school.role, body.role)) throw forbidden('Only the owner can invite admins.');
    const member = db.find('memberships', (row) => row.schoolId === school.id && db.get('users', row.userId)?.email === body.email);
    if (member) throw new HttpError(409, 'already_member', 'This person is already a member of the school.');
    for (const open of db.filter('invitations', (row) => row.schoolId === school.id && row.email === body.email && !row.acceptedAt && !row.revokedAt)) {
      db.update('invitations', open.id, { revokedAt: ctx.now });
    }
    const invitation = db.put('invitations', {
      id: randomId(),
      schoolId: school.id,
      email: body.email,
      role: body.role,
      // Only its hash is kept, as on the server; the link would have gone out by email.
      tokenHash: hash128(randomToken(32)),
      invitedBy: auth.userId,
      createdAt: ctx.now,
      expiresAt: ctx.now + INVITATION_TTL_MS,
      acceptedAt: null,
      revokedAt: null,
    });
    return toInvitation(db, invitation);
  });

  router.add('GET', '/schools/:slug/invitations', { school: 'admin' }, (ctx) =>
    ctx.db
      .filter('invitations', (row) => row.schoolId === ctx.school.id && !row.acceptedAt && !row.revokedAt && row.expiresAt > ctx.now)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 200)
      .map((row) => toInvitation(ctx.db, row)),
  );

  router.add('DELETE', '/schools/:slug/invitations/:invitationId', { school: 'admin', params: { invitationId: uuid } }, (ctx) => {
    const { db, school, params } = ctx;
    const invitation = db.get('invitations', params.invitationId);
    if (!invitation || invitation.schoolId !== school.id || invitation.acceptedAt || invitation.revokedAt) throw notFound('This invitation');
    if (!outranks(school.role, invitation.role)) throw forbidden('Only the owner can manage admin invitations.');
    db.update('invitations', invitation.id, { revokedAt: ctx.now });
  });

  const findUsable = (db, token, now) => {
    const invitation = db.find('invitations', (row) => row.tokenHash === hash128(token));
    if (!invitation || invitation.acceptedAt || invitation.revokedAt || invitation.expiresAt <= now) throw invalidInvitation();
    return invitation;
  };

  router.add('POST', '/invitations/preview', { public: true, body: acceptInvitationInput, status: 200 }, (ctx) => {
    const invitation = findUsable(ctx.db, ctx.body.token, ctx.now);
    const school = ctx.db.get('schools', invitation.schoolId);
    const inviter = invitation.invitedBy ? ctx.db.get('users', invitation.invitedBy) : null;
    return {
      school: { slug: school.slug, name: school.name },
      role: invitation.role,
      email: maskEmail(invitation.email),
      invitedBy: inviter?.name ?? null,
      expiresAt: iso(invitation.expiresAt),
    };
  });

  router.add('POST', '/invitations/accept', { body: acceptInvitationInput, status: 200 }, (ctx) => {
    const { db, auth } = ctx;
    const invitation = findUsable(db, ctx.body.token, ctx.now);
    const user = db.get('users', auth.userId);
    if (!user) throw notFound('This account');
    if (user.email !== invitation.email) {
      throw new HttpError(403, 'invitation_email_mismatch', `This invitation was sent to ${maskEmail(invitation.email)}. Sign in with that address to accept it.`);
    }
    if (db.get('memberships', `${invitation.schoolId}:${user.id}`)) throw new HttpError(409, 'already_member', "You're already a member of this school.");
    db.update('invitations', invitation.id, { acceptedAt: ctx.now });
    const membership = db.put('memberships', {
      id: `${invitation.schoolId}:${user.id}`,
      schoolId: invitation.schoolId,
      userId: user.id,
      role: invitation.role,
      createdAt: ctx.now,
    });
    db.update('users', user.id, { emailVerified: true });
    const school = db.get('schools', invitation.schoolId);
    server.emitToSchool(school.id, 'school:member-joined', { schoolId: school.id, member: toMember(db, membership) });
    return { ...toPublicSchool(school), role: invitation.role };
  });
}
