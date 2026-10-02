import { describe, expect, it } from 'vitest';

import {
  byStart,
  countdownClock,
  durationLabel,
  livePhase,
  liveClassPath,
  meetingOpen,
  replayRef,
  roomOpen,
  scheduleLabel,
  sortAttendees,
  startLabel,
  untilLabel,
  withStatus,
} from '../src/lib/liveClasses.js';

const NOW = Date.parse('2026-10-02T12:00:00Z');
const at = (minutes) => new Date(NOW + minutes * 60_000).toISOString();
const session = (overrides = {}) => ({
  id: 's1',
  title: 'Masterclass',
  startsAt: at(60),
  endsAt: at(120),
  durationMinutes: 60,
  status: 'scheduled',
  provider: 'livekit',
  streamRef: null,
  recordingRef: null,
  startedAt: null,
  endedAt: null,
  canHost: false,
  canJoin: true,
  ...overrides,
});

describe('where a class stands', () => {
  it('follows its status, then the clock', () => {
    expect(livePhase(session(), NOW)).toBe('scheduled');
    expect(livePhase(session({ startsAt: at(15) }), NOW)).toBe('soon');
    expect(livePhase(session({ startsAt: at(16) }), NOW)).toBe('scheduled');
    expect(livePhase(session({ startsAt: at(-2) }), NOW)).toBe('due');
    expect(livePhase(session({ status: 'live' }), NOW)).toBe('live');
    expect(livePhase(session({ status: 'ended' }), NOW)).toBe('ended');
    expect(livePhase(session({ status: 'cancelled', startsAt: at(-5) }), NOW)).toBe('cancelled');
  });

  it('opens the room to students 15 minutes before, and to hosts any time until it ends', () => {
    expect(roomOpen(session(), NOW)).toBe(false);
    expect(roomOpen(session({ startsAt: at(14) }), NOW)).toBe(true);
    expect(roomOpen(session({ canHost: true }), NOW)).toBe(true);
    expect(roomOpen(session({ status: 'live' }), NOW)).toBe(true);
    expect(roomOpen(session({ status: 'ended', canHost: true }), NOW)).toBe(false);
    expect(roomOpen(session({ startsAt: at(5), canJoin: false }), NOW)).toBe(false);
  });

  it('lets a meeting link be followed once live, or 10 minutes before', () => {
    const link = session({ provider: 'link', streamRef: 'https://meet.example.com/abc' });
    expect(meetingOpen({ ...link, startsAt: at(11) }, NOW)).toBe(false);
    expect(meetingOpen({ ...link, startsAt: at(10) }, NOW)).toBe(true);
    expect(meetingOpen({ ...link, status: 'live', startsAt: at(-30) }, NOW)).toBe(true);
    expect(meetingOpen({ ...link, status: 'ended' }, NOW)).toBe(false);
    expect(meetingOpen({ ...link, streamRef: null, status: 'live' }, NOW)).toBe(false);
    expect(meetingOpen({ ...link, canJoin: false, status: 'live' }, NOW)).toBe(false);
    expect(meetingOpen(session({ status: 'live' }), NOW)).toBe(false);
  });

  it('replays the recording, or a YouTube class’s own stream', () => {
    expect(replayRef(session({ provider: 'youtube', streamRef: 'dQw4w9WgXcQ' }))).toBe('dQw4w9WgXcQ');
    expect(replayRef(session({ provider: 'youtube', streamRef: 'dQw4w9WgXcQ', recordingRef: 'aaaaaaaaaaa' }))).toBe('aaaaaaaaaaa');
    expect(replayRef(session({ provider: 'livekit', recordingRef: 'aaaaaaaaaaa' }))).toBe('aaaaaaaaaaa');
    expect(replayRef(session({ provider: 'link', streamRef: 'https://meet.example.com/abc' }))).toBeNull();
  });
});

describe('countdowns and labels', () => {
  it('say how long until it starts', () => {
    expect(untilLabel(30_000)).toBe('less than a minute');
    expect(untilLabel(12 * 60_000 + 59_000)).toBe('12 min');
    expect(untilLabel(3 * 3600_000 + 5 * 60_000)).toBe('3 h 05 min');
    expect(untilLabel(2 * 86_400_000 + 4 * 3600_000)).toBe('2 d 4 h');
    expect(untilLabel(86_400_000)).toBe('1 d');
  });

  it('tick as a clock within a day', () => {
    expect(countdownClock(65_000)).toBe('1:05');
    expect(countdownClock(3_725_000)).toBe('1:02:05');
    expect(countdownClock(500)).toBe('0:01');
    expect(countdownClock(-5)).toBe('0:00');
    expect(countdownClock(90_000_000)).toBe('1 d 1 h');
  });

  it('count down within 24 hours, and give the date further out', () => {
    expect(startLabel(session({ startsAt: at(90) }), NOW)).toBe('Starts in 1 h 30 min');
    expect(startLabel(session({ startsAt: at(-1) }), NOW)).toBe('Starting soon');
    expect(startLabel(session({ status: 'live' }), NOW)).toBe('Live now');
    expect(startLabel(session({ status: 'cancelled' }), NOW)).toBe('Cancelled');
    expect(startLabel(session({ startsAt: at(3 * 24 * 60) }), NOW)).toMatch(/^[A-Z][a-z]{2}, Oct \d+, \d+:\d{2}\s?[AP]M$/);
  });

  it('say when a class is, start to end', () => {
    const label = scheduleLabel(session({ startsAt: '2026-10-08T15:00:00Z', endsAt: '2026-10-08T16:30:00Z' }), NOW);
    expect(label).toMatch(/^[A-Z][a-z]{2}, Oct \d+, \d{1,2}:\d{2}\s?(?:[AP]M\s?)?–\s?\d{1,2}:30\s?[AP]M$/);
    expect(scheduleLabel(session({ startsAt: '2027-01-08T15:00:00Z', endsAt: '2027-01-08T16:00:00Z' }), NOW)).toContain('2027');
    expect(scheduleLabel(null)).toBe('');
  });

  it('name durations', () => {
    expect(durationLabel(45)).toBe('45 min');
    expect(durationLabel(90)).toBe('1 h 30 min');
    expect(durationLabel(120)).toBe('2 h');
  });
});

describe('lists of classes', () => {
  it('put live ones first, then the soonest', () => {
    const list = [session({ id: 'b', startsAt: at(300) }), session({ id: 'a', startsAt: at(60) }), session({ id: 'live', status: 'live', startsAt: at(-10) })];
    expect(list.sort(byStart).map((item) => item.id)).toEqual(['live', 'a', 'b']);
  });

  it('take a status change for the same class only', () => {
    const before = session();
    const event = { sessionId: 's1', status: 'live', startedAt: at(0), endedAt: null };
    expect(withStatus(before, event)).toMatchObject({ status: 'live', startedAt: at(0) });
    expect(withStatus(before, { ...event, sessionId: 'other' })).toBe(before);
    expect(withStatus(undefined, event)).toBeUndefined();
  });

  it('link to the class page', () => expect(liveClassPath('riverside', 'piano', 's1')).toBe('/s/riverside/c/piano/live/s1'));

  it('list who’s there: hosts, raised hands, speakers, then the rest by name', () => {
    const people = [
      { userId: '1', name: 'Zoe', host: false, handRaised: false, speaker: false },
      { userId: '2', name: 'Ali', host: false, handRaised: false, speaker: true },
      { userId: '3', name: 'Maya', host: true, handRaised: false, speaker: false },
      { userId: '4', name: 'Ben', host: false, handRaised: true, speaker: false },
      { userId: '5', name: 'Ada', host: false, handRaised: false, speaker: false },
    ];
    expect(sortAttendees(people).map((p) => p.name)).toEqual(['Maya', 'Ben', 'Ali', 'Ada', 'Zoe']);
    expect(sortAttendees(undefined)).toEqual([]);
  });
});
