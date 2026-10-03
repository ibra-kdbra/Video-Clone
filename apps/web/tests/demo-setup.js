import { expect } from 'vitest';

import * as CONTENT from '../src/demo/content.js';
import { createServer } from '../src/demo/core.js';
import { MEDIA } from '../src/demo/media.js';
import { ids } from '../src/demo/seed.js';
import * as SOCIAL from '../src/demo/social.js';

/**
 * The demo's mock API for the Phase 3 tests (demo-discussions, demo-live, demo-search), against
 * the real demo content: time stands still unless a test moves it, storage is in memory, and
 * timers run by hand. `messages` collects everything the WebSocket would have sent, with whom it
 * was for (`userId`, `schoolId`, `course` watchers, or a `live` class's room).
 */

export const START = Date.parse('2026-10-01T12:00:00Z');
export const SCHOOL = CONTENT.SCHOOL.slug;
export const MINUTE = 60_000;

export function memoryStorage(entries = []) {
  const map = new Map(entries);
  return { map, get: (key) => map.get(key) ?? null, set: (key, value) => map.set(key, value), remove: (key) => map.delete(key) };
}

export function setup({ storage = memoryStorage(), clock = { now: START }, social = SOCIAL } = {}) {
  // Deliveries (no delay) run when the test flushes; jobs and the live rooms' script when it moves the clock.
  const pending = [];
  const timers = {
    setTimeout: (fn, ms) => {
      if (!ms) pending.push(fn);
      return pending.length;
    },
    clearTimeout: () => {},
  };
  const server = createServer({ content: CONTENT, media: MEDIA, social, now: () => clock.now, storage, latency: 0, userAgent: 'Vitest', timers, strict: true });
  const messages = [];
  server.subscribe((message) => messages.push(message));
  const flushTimers = () => {
    while (pending.length) pending.shift()();
  };

  async function call(method, path, { token, body } = {}) {
    const headers = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await server.fetch(`/api/v1${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await response.text();
    flushTimers();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  }
  const signIn = async (key, password = CONTENT.DEMO_PASSWORD) => {
    const result = await call('POST', '/auth/login', { body: { email: `${key}@grand-academy.demo`, password } });
    expect(result.status).toBe(200);
    return result.body.accessToken;
  };
  /** Moves the clock, running what's due on the way (jobs, and the live rooms' script, a second at a time). */
  const advance = (ms, { step = 1000 } = {}) => {
    const end = clock.now + ms;
    while (clock.now < end) {
      clock.now = Math.min(end, clock.now + step);
      server.runJobs();
      flushTimers();
    }
  };
  /** The socket's commands, as socket.js sends them, answered at once. */
  const socket = (key) => {
    const userId = ids.user(key);
    const run = (fn) => {
      const result = fn();
      flushTimers();
      return result;
    };
    return {
      userId,
      watch: (courseId) => run(() => server.realtime.watchCourse(userId, { courseId })),
      join: (sessionId) => run(() => server.realtime.join(userId, { sessionId })),
      leave: (sessionId) => run(() => server.realtime.leave(userId, { sessionId })),
      say: (sessionId, body) => run(() => server.realtime.message(userId, { sessionId, body })),
      hand: (sessionId, raised) => run(() => server.realtime.hand(userId, { sessionId, raised })),
    };
  };
  const sent = (filter) => messages.filter((message) => Object.entries(filter).every(([key, value]) => message[key] === value));
  return { server, call, signIn, advance, storage, clock, messages, sent, flushTimers, socket };
}

export const course = (slug) => `/schools/${SCHOOL}/courses/${slug}`;
export const lessonId = (slug, key) => ids.lesson(slug, key);
export const thread = (slug, ...keys) => ids.post(slug, ...keys);
/** A seeded live class, in the occurrence that started at `occurrence` (by default, the first page load at START). */
export const liveId = (key, occurrence = START) => ids.live(key, occurrence);
export const userId = (key) => ids.user(key);
export { CONTENT, SOCIAL, ids };
