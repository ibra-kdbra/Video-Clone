import { apiFetch } from './session.js';

/**
 * The Grand LMS API's endpoints, one function each. Every path segment that comes from data is
 * encoded, so an odd slug or id can only ever name a resource, never change the path.
 */
const seg = encodeURIComponent;
const school = (slug) => `/schools/${seg(slug)}`;

export const getMe = (signal) => apiFetch('/auth/me', { signal });
export const getDevices = (signal) => apiFetch('/auth/sessions', { signal });
export const signOutDevice = (id) => apiFetch(`/auth/sessions/${seg(id)}`, { method: 'DELETE' });

export const createSchool = (input) => apiFetch('/schools', { method: 'POST', body: input });
export const getSchool = (slug, signal) => apiFetch(school(slug), { signal });
export const getPublicSchool = (slug, signal) => apiFetch(`${school(slug)}/public`, { signal, auth: false });

const MEMBERS_PAGE = 50;

export function getMembers(slug, cursor, signal) {
  const params = new URLSearchParams({ limit: String(MEMBERS_PAGE) });
  if (cursor) params.set('cursor', cursor);
  return apiFetch(`${school(slug)}/members?${params}`, { signal });
}

export const updateMember = (slug, userId, role) => apiFetch(`${school(slug)}/members/${seg(userId)}`, { method: 'PATCH', body: { role } });
export const removeMember = (slug, userId) => apiFetch(`${school(slug)}/members/${seg(userId)}`, { method: 'DELETE' });

export const getInvitations = (slug, signal) => apiFetch(`${school(slug)}/invitations`, { signal });
export const createInvitation = (slug, input) => apiFetch(`${school(slug)}/invitations`, { method: 'POST', body: input });
export const cancelInvitation = (slug, id) => apiFetch(`${school(slug)}/invitations/${seg(id)}`, { method: 'DELETE' });

// The token travels in the request body, never the URL, so it stays out of logs.
export const previewInvitation = (token, signal) => apiFetch('/invitations/preview', { method: 'POST', body: { token }, signal, auth: false });
export const acceptInvitation = (token) => apiFetch('/invitations/accept', { method: 'POST', body: { token } });

/** Queries holding one person's data, dropped when they sign out. */
export const PRIVATE_QUERIES = new Set(['me', 'school', 'members', 'invitations', 'devices', 'courses', 'course', 'lesson', 'playback', 'enrollments', 'storage']);
