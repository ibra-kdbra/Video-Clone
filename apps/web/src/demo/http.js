import { ROLE_RANK, schoolSlug } from '@grand/contracts';

import { randomToken } from './ids.js';

/**
 * The mock API's plumbing: errors in the API's one error shape, the route table, and the checks
 * every real request goes through in the same order as on the server: the access token (the
 * AuthGuard), the school and the caller's role in it (the SchoolAccessGuard), then the path
 * parameters, query and body against the shared schemas (the validation pipe).
 */

export class HttpError extends Error {
  constructor(status, code, message, details, headers) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
    this.headers = headers;
    /** Set when what was done before the refusal stands (the API had committed it). */
    this.keep = false;
  }
}

/** A refusal that keeps the request's changes, as when the API cleans up and then says no. */
export function keeping(error) {
  error.keep = true;
  return error;
}

export const notFound = (what = 'This page') => new HttpError(404, 'not_found', `${what} doesn't exist.`);
export const forbidden = (message = "You don't have access to this.") => new HttpError(403, 'forbidden', message);
export const unauthenticated = (message = 'Sign in to continue.') => new HttpError(401, 'unauthenticated', message);
export const conflict = (message) => new HttpError(409, 'conflict', message);
export const badRequest = (message) => new HttpError(400, 'bad_request', message);

/** Zod issues as the API lists them: `{ path: 'a.b', message }`. */
export const formatIssues = (issues) =>
  issues.map((issue) => ({ path: (issue.path ?? []).map((segment) => String(typeof segment === 'object' ? segment.key : segment)).join('.'), message: issue.message }));

/** Parses `value` with a shared schema, or fails the way the API's validation pipe does. */
export function parse(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) throw new HttpError(400, 'validation_failed', 'Some fields need attention.', formatIssues(result.error.issues));
  return result.data;
}

const json = (status, body, headers = {}) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });

export function errorResponse(error) {
  const requestId = `demo-${randomToken(6)}`;
  if (error instanceof HttpError) {
    const body = { error: { code: error.code, message: error.message, ...(error.details && { details: error.details }), requestId } };
    return json(error.status, body, error.headers);
  }
  console.error('Demo API error', error);
  return json(500, { error: { code: 'internal', message: 'Something went wrong on our side. Please try again.', requestId } });
}

export const ok = (body, status = 200) => (body === undefined || body === null ? new Response(null, { status: 204 }) : json(status, body));

/**
 * The route table. `options`:
 * - `public`: no sign-in needed (a token, if sent, is still read).
 * - `school`: the least role needed in the school named by `:slug`.
 * - `params`: schemas for path parameters, checked in order; `query` and `body`: schemas.
 * - `status`: the success status (200, or 201 for creation; 204 when the handler returns nothing).
 */
export function createRouter() {
  const routes = [];
  const add = (method, pattern, options, handler) => routes.push({ method, parts: pattern.split('/').filter(Boolean), options, handler });

  function match(method, path) {
    const parts = path.split('/').filter(Boolean);
    let methodMismatch = false;
    for (const route of routes) {
      if (route.parts.length !== parts.length) continue;
      const params = {};
      let matched = true;
      for (let i = 0; i < parts.length; i++) {
        const want = route.parts[i];
        if (want.startsWith(':')) {
          try {
            params[want.slice(1)] = decodeURIComponent(parts[i]);
          } catch {
            matched = false;
            break;
          }
        } else if (want !== parts[i]) {
          matched = false;
          break;
        }
      }
      if (!matched) continue;
      if (route.method !== method) {
        methodMismatch = true;
        continue;
      }
      return { route, params };
    }
    return methodMismatch ? { notAllowed: true } : null;
  }

  return { add, match, routes };
}

/** The SchoolAccessGuard: the school in `:slug` and the caller's role there, or the API's refusal. */
export function schoolAccess(db, userId, slug, needed) {
  const parsed = schoolSlug.safeParse(slug);
  if (!parsed.success) throw notFound('This school');
  const school = db.find('schools', (row) => row.slug === parsed.data);
  if (!school) throw notFound('This school');
  const membership = db.get('memberships', `${school.id}:${userId}`);
  if (!membership) throw forbidden("You're not a member of this school.");
  if (ROLE_RANK[membership.role] < ROLE_RANK[needed]) throw forbidden(`Only a school ${needed} or above can do this.`);
  return { id: school.id, slug: school.slug, name: school.name, createdAt: school.createdAt, role: membership.role };
}
