import { describe, expect, it } from 'vitest';
import { createLiveSessionInput } from '@grand/contracts';

import { formatOffset, isoToZoned, offsetMinutes, timeZoneLabel, zonedToIso } from '../src/lib/zonedTime.js';

describe('a date and time in a time zone', () => {
  it('becomes an ISO instant with that zone’s offset on that day', () => {
    expect(zonedToIso('2026-10-08', '17:00', 'Europe/Paris')).toBe('2026-10-08T17:00:00+02:00');
    expect(zonedToIso('2026-12-08', '17:00', 'Europe/Paris')).toBe('2026-12-08T17:00:00+01:00');
    expect(zonedToIso('2026-10-08', '09:30', 'America/New_York')).toBe('2026-10-08T09:30:00-04:00');
    expect(zonedToIso('2026-10-08', '09:30', 'Asia/Kolkata')).toBe('2026-10-08T09:30:00+05:30');
    expect(zonedToIso('2026-10-08', '09:30', 'UTC')).toBe('2026-10-08T09:30:00+00:00');
    expect(zonedToIso('2026-01-15', '23:45', 'Pacific/Chatham')).toBe('2026-01-15T23:45:00+13:45');
  });

  it('is the same instant whatever the zone it was typed in', () => {
    const paris = Date.parse(zonedToIso('2026-10-08', '17:00', 'Europe/Paris'));
    const york = Date.parse(zonedToIso('2026-10-08', '11:00', 'America/New_York'));
    expect(paris).toBe(york);
    expect(new Date(paris).toISOString()).toBe('2026-10-08T15:00:00.000Z');
  });

  it('moves a time skipped by the clocks going forward on by the gap, and takes the first of a repeated one', () => {
    // New York, 8 March 2026: 2:00 became 3:00.
    expect(zonedToIso('2026-03-08', '02:30', 'America/New_York')).toBe('2026-03-08T03:30:00-04:00');
    // Paris, 29 March 2026: 2:00 became 3:00.
    expect(zonedToIso('2026-03-29', '02:30', 'Europe/Paris')).toBe('2026-03-29T03:30:00+02:00');
    // New York, 1 November 2026: 1:30 happened twice.
    expect(zonedToIso('2026-11-01', '01:30', 'America/New_York')).toBe('2026-11-01T01:30:00-04:00');
    expect(zonedToIso('2026-11-01', '03:00', 'America/New_York')).toBe('2026-11-01T03:00:00-05:00');
  });

  it('refuses what isn’t a date and a time', () => {
    expect(zonedToIso('', '17:00', 'UTC')).toBeNull();
    expect(zonedToIso('2026-10-08', '', 'UTC')).toBeNull();
    expect(zonedToIso('2026-02-30', '10:00', 'UTC')).toBeNull();
    expect(zonedToIso('2026-13-01', '10:00', 'UTC')).toBeNull();
    expect(zonedToIso('2026-10-08', '24:00', 'UTC')).toBeNull();
    expect(zonedToIso('8/10/2026', '10:00', 'UTC')).toBeNull();
  });

  it('is what the API accepts as a start time', () => {
    const input = { title: 'Masterclass', startsAt: zonedToIso('2026-10-08', '17:00', 'Asia/Kolkata'), durationMinutes: 60, provider: 'livekit' };
    expect(createLiveSessionInput.safeParse(input).success).toBe(true);
  });

  it('comes back as the date and time on that zone’s clock', () => {
    expect(isoToZoned('2026-10-08T15:00:00Z', 'Europe/Paris')).toEqual({ date: '2026-10-08', time: '17:00' });
    expect(isoToZoned('2026-10-08T15:00:00Z', 'America/Los_Angeles')).toEqual({ date: '2026-10-08', time: '08:00' });
    expect(isoToZoned('2026-10-08T23:30:00Z', 'Asia/Tokyo')).toEqual({ date: '2026-10-09', time: '08:30' });
    expect(isoToZoned('nope', 'UTC')).toEqual({ date: '', time: '' });
    for (const zone of ['Europe/Paris', 'America/New_York', 'Asia/Kolkata', 'Australia/Adelaide']) {
      const { date, time } = isoToZoned('2026-07-01T12:34:00Z', zone);
      expect(Date.parse(zonedToIso(date, time, zone))).toBe(Date.parse('2026-07-01T12:34:00Z'));
    }
  });

  it('names the zone and its offset', () => {
    expect(offsetMinutes(Date.parse('2026-10-08T12:00:00Z'), 'Europe/Paris')).toBe(120);
    expect(offsetMinutes(Date.parse('2026-12-08T12:00:00Z'), 'America/New_York')).toBe(-300);
    expect(formatOffset(330)).toBe('+05:30');
    expect(formatOffset(-240)).toBe('-04:00');
    expect(timeZoneLabel('Europe/Paris', Date.parse('2026-10-08T12:00:00Z'))).toBe('Europe/Paris (GMT+2)');
    expect(timeZoneLabel('Asia/Kolkata', Date.parse('2026-10-08T12:00:00Z'))).toBe('Asia/Kolkata (GMT+5:30)');
    expect(timeZoneLabel('America/Los_Angeles', Date.parse('2026-10-08T12:00:00Z'))).toBe('America/Los Angeles (GMT-7)');
    expect(timeZoneLabel('UTC', 0)).toBe('UTC (GMT)');
  });
});
