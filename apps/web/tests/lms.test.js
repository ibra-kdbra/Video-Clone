import { describe, expect, it } from 'vitest';
import { ROLE_RANK as CONTRACT_RANK, loginInput, signupInput } from '@grand/contracts';

import { describeDevice } from '../src/lib/devices.js';
import { detailsByField, errorMessage, issuesByField, waitFor } from '../src/lib/forms.js';
import { ROLE_RANK, assignableRoles, canLeave, canManage, withArticle } from '../src/lib/roles.js';
import { initials, toneFor } from '../src/lib/tone.js';

describe('school roles', () => {
  it('rank the same as the API', () => expect(ROLE_RANK).toEqual(CONTRACT_RANK));

  it('offer only the roles below your own', () => {
    expect(assignableRoles('owner')).toEqual(['admin', 'instructor', 'student']);
    expect(assignableRoles('admin')).toEqual(['instructor', 'student']);
    expect(assignableRoles('instructor')).toEqual([]);
    expect(assignableRoles('student')).toEqual([]);
  });

  it('let people manage only those below them, never themselves or the owner', () => {
    expect(canManage('owner', 'admin')).toBe(true);
    expect(canManage('admin', 'instructor')).toBe(true);
    expect(canManage('admin', 'admin')).toBe(false);
    expect(canManage('owner', 'owner')).toBe(false);
    expect(canManage('instructor', 'student')).toBe(false);
    expect(canManage('owner', 'student', true)).toBe(false);
  });

  it('let everyone but the owner leave', () => {
    expect(canLeave('owner')).toBe(false);
    expect(['admin', 'instructor', 'student'].every(canLeave)).toBe(true);
  });

  it('read naturally', () => {
    expect(withArticle('admin')).toBe('an admin');
    expect(withArticle('instructor')).toBe('an instructor');
    expect(withArticle('student')).toBe('a student');
  });
});

describe('form errors', () => {
  it('come from the shared schemas, one message per field', () => {
    expect(issuesByField(loginInput.safeParse({ email: 'nope', password: '' }))).toEqual({
      email: 'Enter a valid email address',
      password: 'Enter your password',
    });
    expect(issuesByField(signupInput.safeParse({ email: 'ada@example.com', password: 'short', name: 'Ada' }))).toEqual({ password: 'Use at least 10 characters' });
    expect(issuesByField(loginInput.safeParse({ email: 'ada@example.com', password: 'x' }))).toEqual({});
  });

  it("and from the server's details", () => {
    const error = { details: [{ path: 'slug', message: 'This address is taken.' }, { path: '', message: 'Try again.' }, { path: 'slug', message: 'Second' }] };
    expect(detailsByField(error)).toEqual({ slug: 'This address is taken.', '': 'Try again.' });
    expect(detailsByField(undefined)).toEqual({});
  });

  it('say how long to wait when rate limited', () => {
    expect(waitFor(30)).toBe('in 30 seconds');
    expect(waitFor(600)).toBe('in 10 minutes');
    expect(errorMessage({ code: 'rate_limited', retryAfter: 120, message: 'Too many requests.' })).toBe('Too many attempts. Please try again in 2 minutes.');
    expect(errorMessage({ code: 'forbidden', message: 'No.' })).toBe('No.');
  });
});

describe('devices', () => {
  it.each([
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36', 'Chrome on macOS', false],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1', 'Safari on iPhone', true],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0', 'Edge on Windows', false],
    ['Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0', 'Firefox on Linux', false],
    ['Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36', 'Chrome on Android', true],
    ['curl/8.5.0', 'curl', false],
    [null, 'Unknown device', false],
  ])('%s → %s', (ua, label, mobile) => expect(describeDevice(ua)).toEqual({ label, mobile }));
});

describe('monograms', () => {
  it('keep a school in the same colors', () => {
    expect(toneFor('riverside')).toBe(toneFor('riverside'));
    expect(new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'].map(toneFor)).size).toBeGreaterThan(3);
    expect(['riverside', 'x', ''].map(toneFor).every((tone) => tone >= 1 && tone <= 6)).toBe(true);
  });

  it('use the first letters of the first words', () => {
    expect(initials('Riverside Music Academy')).toBe('RM');
    expect(initials('Ada Lovelace', 1)).toBe('A');
    expect(initials('école')).toBe('É');
    expect(initials('  ')).toBe('?');
  });
});
