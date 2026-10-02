import { describe, expect, it } from 'vitest';

import { buildIcs, escapeText, foldLine, icsDate, icsFileName } from '../src/lib/calendar.js';

const session = {
  id: '6f1c2c4e-7a39-4b8c-9a0e-1f2d3c4b5a69',
  title: 'Masterclass: scales, chords; and more',
  description: 'Bring your instrument.\nWe start on time.',
  startsAt: '2026-10-08T17:00:00+02:00',
  endsAt: '2026-10-08T18:30:00+02:00',
  status: 'scheduled',
  host: { id: 'u1', name: 'Maya Haddad' },
};

describe('the .ics file for a live class', () => {
  const ics = buildIcs(session, { url: 'https://grand.example/s/riverside/c/piano/live/6f1c', now: new Date('2026-10-02T10:00:00Z'), courseTitle: 'Piano' });
  const lines = ics.split('\r\n');

  it('is one calendar with one event, in UTC, with CRLF line ends', () => {
    expect(lines[0]).toBe('BEGIN:VCALENDAR');
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
    expect(lines).toContain('DTSTART:20261008T150000Z');
    expect(lines).toContain('DTEND:20261008T163000Z');
    expect(lines).toContain('DTSTAMP:20261002T100000Z');
    expect(lines).toContain(`UID:${session.id}@grand-lms`);
    expect(lines).toContain('STATUS:CONFIRMED');
    expect(lines).toContain('TRIGGER:-PT15M');
  });

  it('escapes text values', () => {
    expect(lines).toContain('SUMMARY:Masterclass: scales\\, chords\\; and more');
    expect(escapeText('a\\b;c,d\ne\r\nf')).toBe('a\\\\b\\;c\\,d\\ne\\nf');
    const unfolded = ics.replace(/\r\n /g, '');
    expect(unfolded).toContain(
      'DESCRIPTION:Bring your instrument.\\nWe start on time.\\n\\nCourse: Piano\\n\\nHost: Maya Haddad\\n\\nJoin: https://grand.example/s/riverside/c/piano/live/6f1c',
    );
  });

  it('folds long lines at 75 octets without splitting a character', () => {
    for (const line of lines) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    const long = `SUMMARY:${'é'.repeat(60)}`;
    const folded = foldLine(long);
    expect(folded.split('\r\n').every((part) => new TextEncoder().encode(part).length <= 75)).toBe(true);
    expect(folded.replace(/\r\n /g, '')).toBe(long);
    expect(foldLine('SHORT:line')).toBe('SHORT:line');
  });

  it('marks a cancelled class as cancelled', () => {
    expect(buildIcs({ ...session, status: 'cancelled' }, {})).toContain('STATUS:CANCELLED');
  });

  it('formats dates and names the file from the title', () => {
    expect(icsDate('2026-01-02T03:04:05.678Z')).toBe('20260102T030405Z');
    expect(() => icsDate('nope')).toThrow();
    expect(icsFileName('Masterclass: Ünïcode & more!')).toBe('masterclass-unicode-more.ics');
    expect(icsFileName('!!!')).toBe('live-class.ics');
  });
});
