import { describe, expect, it } from 'vitest';

import { authPath, safeNext } from '../src/lib/paths.js';

describe('safeNext: where to go after signing in', () => {
  it.each(['/', '/s/riverside', '/account', '/invite', '/search?q=jazz%20piano', '/s/riverside?tab=members#top', '/signin-help'])('follows %s', (path) =>
    expect(safeNext(path)).toBe(path),
  );

  it.each([
    ['nothing', null],
    ['an empty value', ''],
    ['a number', 42],
    ['another site', 'https://evil.example/'],
    ['a protocol-relative address', '//evil.example'],
    ['a backslash address', '/\\evil.example'],
    ['backslashes further in', '/\\/evil.example'],
    ['a tab that browsers drop', '/\t/evil.example'],
    ['a newline that browsers drop', '/\n/evil.example'],
    ['a script', 'javascript:alert(1)'],
    ['a relative path', 'account'],
    ['a leading space', ' /account'],
    ['the sign-in page', '/signin'],
    ['the sign-up page', '/signup?next=/account'],
    ['something very long', `/${'a'.repeat(2100)}`],
  ])('falls back for %s', (_label, value) => expect(safeNext(value)).toBe('/'));

  it('uses the given fallback', () => expect(safeNext('//evil.example', '/account')).toBe('/account'));
});

describe('authPath', () => {
  it('adds the return path, encoded', () => expect(authPath('signin', '/s/riverside?tab=members')).toBe('/signin?next=%2Fs%2Friverside%3Ftab%3Dmembers'));

  it('leaves it off for the home page and for unsafe paths', () => {
    expect(authPath('signup', '/')).toBe('/signup');
    expect(authPath('signin', '//evil.example')).toBe('/signin');
  });
});
