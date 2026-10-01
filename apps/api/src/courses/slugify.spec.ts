import { describe, expect, it } from 'vitest';
import { slugify } from './slugify.js';

describe('slugify', () => {
  it('turns a title into an address', () => {
    expect(slugify('Intro to Música!')).toBe('intro-to-musica');
    expect(slugify('  Linear   Algebra -- Part 2 ')).toBe('linear-algebra-part-2');
    expect(slugify('日本語')).toBe('');
    expect(slugify('a'.repeat(80))).toHaveLength(60);
    expect(slugify(`${'ab-'.repeat(25)}`, 10)).toBe('ab-ab-ab-a');
  });
});
