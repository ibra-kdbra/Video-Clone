import { describe, expect, it } from 'vitest';
import { decodeCursor, encodeCursor } from './cursor.js';

describe('cursors', () => {
  it('round-trips the sort values', () => {
    const values = ['2026-09-30 08:51:55.180123+00', '9af37553-bfb8-44b4-b723-cbdc1313a44b'];
    expect(decodeCursor(encodeCursor(values), 2)).toEqual(values);
  });

  it('rejects anything that is not a cursor this API made', () => {
    for (const cursor of ['', 'bogus', encodeCursor(['one']), Buffer.from('{"a":1}').toString('base64url'), encodeCursor(['x'.repeat(65), 'y'])]) {
      expect(() => decodeCursor(cursor, 2)).toThrow('no longer valid');
    }
  });
});
