import { describe, expect, it } from 'vitest';
import { maskEmail } from './invitations.service.js';

describe('maskEmail', () => {
  it('keeps the first letter and the domain', () => {
    expect(maskEmail('jordan.lee@example.com')).toBe('j******@example.com');
    expect(maskEmail('al@example.com')).toBe('a**@example.com');
    expect(maskEmail('a@example.com')).toBe('a**@example.com');
  });
});
