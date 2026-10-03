import { describe, expect, it } from 'vitest';

import { STALE_LIVE_MS } from '../src/demo/core.js';
import { STORAGE_KEY } from '../src/demo/store.js';
import { MINUTE, SOCIAL, START, course, liveId, memoryStorage, setup, userId } from './demo-setup.js';

/**
 * Phase 3's live classes in the demo's mock API (apps/api/src/live): the schedule, scheduling and
 * running a class, the room on the live connection (joining, chat, hands, speakers, presence),
 * attendance, the notifications, and the scripted classmates who make the demo's room feel alive.
 * The clock starts at 12:00 UTC: the office hours went live at 11:50, the sound drop-in is at
 * 12:20 (its room opens at 12:05), the essay workshop in two days; the calculus drop-in was
 * cancelled; the span Q&A was six days ago.
 */

const LA = 'linear-algebra-visually';
const SOUND = 'physics-of-sound';
const live = (slug) => `${course(slug)}/live`;
const session = (slug, key) => `${live(slug)}/${liveId(key)}`;
const OFFICE = liveId('office-hours');
const DROP_IN = liveId('sound-drop-in');

describe('the schedule', () => {
  it('offers YouTube and meeting links (no LiveKit in the demo)', async () => {
    const { call, signIn } = setup();
    const amira = await signIn('amira');
    expect((await call('GET', '/schools/grand-academy/live/options', { token: amira })).body).toEqual({ providers: ['youtube', 'link'] });
  });

  it('lists the classes of the courses each person takes or teaches', async () => {
    const { call, signIn } = setup();
    const amira = await signIn('amira');
    const upcoming = (await call('GET', '/schools/grand-academy/live', { token: amira })).body;
    expect(upcoming.map((item) => item.id)).toEqual([OFFICE, DROP_IN, liveId('rivers-seminar')]);
    expect(upcoming[0]).toMatchObject({
      status: 'live',
      courseSlug: LA,
      provider: 'youtube',
      streamRef: 'kYB8IZa5AuE',
      startsAt: '2026-10-01T11:50:00.000Z',
      endsAt: '2026-10-01T12:50:00.000Z',
      startedAt: '2026-10-01T11:50:00.000Z',
      host: { id: userId('daniel'), name: 'Daniel Okafor' },
      canHost: false,
      canJoin: true,
    });
    expect(upcoming[0].attendeeCount).toBeGreaterThan(5);
    // A meeting link only shows close to the start.
    expect(upcoming[1]).toMatchObject({ provider: 'link', status: 'scheduled', startsAt: '2026-10-01T12:20:00.000Z', streamRef: null });
    expect(upcoming[2]).toMatchObject({ provider: 'link', startsAt: '2026-10-03T12:00:00.000Z', host: { name: 'Omar Siddiqui' } });

    const past = (await call('GET', '/schools/grand-academy/live?when=past', { token: amira })).body;
    expect(past).toHaveLength(1);
    expect(past[0]).toMatchObject({ id: liveId('span-qa'), status: 'ended', recordingRef: 'k7RM-ot2NWY' });
    expect(past[0].attendeeCount).toBeGreaterThanOrEqual(15);

    // Daniel teaches: his classes, the cancelled one too (it hasn't passed).
    const daniel = await signIn('daniel');
    const his = (await call('GET', '/schools/grand-academy/live', { token: daniel })).body;
    expect(his.map((item) => item.id)).toEqual([OFFICE, DROP_IN, liveId('derivatives-drop-in')]);
    expect(his[1]).toMatchObject({ canHost: true, streamRef: 'https://meet.example.com/grand-academy/sound-drop-in' });
    expect(his[2]).toMatchObject({ status: 'cancelled' });
    expect((await call('GET', '/schools/grand-academy/live?when=later', { token: daniel })).status).toBe(400);
  });

  it('shows a course’s classes to anyone who can see the course, without the video for outsiders', async () => {
    const { call, signIn, advance } = setup();
    const amira = await signIn('amira');
    const calculus = (await call('GET', live('calculus-first-steps'), { token: amira })).body;
    expect(calculus).toEqual([expect.objectContaining({ id: liveId('derivatives-drop-in'), status: 'cancelled', canJoin: false, canHost: false, streamRef: null })]);
    expect((await call('GET', session(LA, 'span-qa'), { token: amira })).body.recordingRef).toBe('k7RM-ot2NWY');
    const lena = await signIn('lena');
    expect((await call('GET', session(LA, 'office-hours'), { token: lena })).body).toMatchObject({ canHost: true, canJoin: true });
    expect((await call('GET', `${live(LA)}/${DROP_IN}`, { token: amira })).body.error).toMatchObject({ code: 'not_found', message: "This class doesn't exist." });

    // The meeting link shows from ten minutes before.
    advance(9 * MINUTE + 59_000, { step: 30_000 });
    expect((await call('GET', `${live(SOUND)}/${DROP_IN}`, { token: amira })).body.streamRef).toBeNull();
    advance(1000);
    expect((await call('GET', `${live(SOUND)}/${DROP_IN}`, { token: amira })).body.streamRef).toBe('https://meet.example.com/grand-academy/sound-drop-in');
  });
});

describe('scheduling and running a class', () => {
  const tomorrow = '2026-10-01T18:00:00.000Z';
  const input = {
    title: 'Sound check-in',
    description: 'Questions on timbre.',
    startsAt: tomorrow,
    durationMinutes: 45,
    provider: 'youtube',
    streamRef: 'https://www.youtube.com/live/kYB8IZa5AuE?feature=share',
  };

  it('checks what it’s given, as the API does', async () => {
    const { call, signIn } = setup();
    const daniel = await signIn('daniel');
    const amira = await signIn('amira');
    expect((await call('POST', live(SOUND), { token: amira, body: input })).body.error).toMatchObject({
      code: 'forbidden',
      message: 'Only a school instructor or above can do this.',
    });
    const bad = await call('POST', live(SOUND), { token: daniel, body: { ...input, title: 'X', durationMinutes: 3, startsAt: 'tomorrow' } });
    expect(bad.body.error.details.map((detail) => detail.path).sort()).toEqual(['durationMinutes', 'startsAt', 'title']);
    expect((await call('POST', live(SOUND), { token: daniel, body: { ...input, provider: 'livekit', streamRef: null } })).body.error).toMatchObject({
      code: 'validation_failed',
      details: [{ path: 'provider', message: "Live video in the browser isn't set up on this server. Use YouTube Live or a meeting link." }],
    });
    expect((await call('POST', live(SOUND), { token: daniel, body: { ...input, startsAt: new Date(START - 2 * MINUTE).toISOString() } })).body.error.details).toEqual([
      { path: 'startsAt', message: 'Choose a time in the future' },
    ]);
    expect((await call('POST', live(SOUND), { token: daniel, body: { ...input, provider: 'link', streamRef: 'http://meet.example.com/x' } })).body.error.details).toEqual([
      { path: 'streamRef', message: 'Add the meeting’s https:// address' },
    ]);
    expect((await call('POST', live('neural-networks'), { token: daniel, body: input })).body.error).toMatchObject({
      code: 'forbidden',
      message: "Only the course's editors run its classes.",
    });
  });

  it('schedules, reminds, starts, ends, and keeps the record', async () => {
    const { call, signIn, server, advance, sent } = setup();
    const daniel = await signIn('daniel');
    const amira = await signIn('amira');
    const soon = new Date(START + 20 * MINUTE).toISOString();
    const created = await call('POST', live(SOUND), { token: daniel, body: { ...input, startsAt: soon } });
    expect(created).toMatchObject({ status: 201, body: { status: 'scheduled', streamRef: 'kYB8IZa5AuE', canHost: true, host: { name: 'Daniel Okafor' }, attendeeCount: 0 } });
    const url = `${live(SOUND)}/${created.body.id}`;
    const latest = (key, type) => server.db.filter('notifications', (row) => row.userId === userId(key) && row.type === type).sort((a, b) => b.createdAt - a.createdAt)[0];
    expect(latest('amira', 'live.scheduled').data).toEqual({
      title: 'Live class: Sound check-in',
      body: 'The Physics of Sound · Thu 1 Oct, 12:20 UTC',
      path: `/s/grand-academy/c/${SOUND}/live/${created.body.id}`,
      schoolName: 'Grand Academy',
    });

    // Fifteen minutes before: the students and the host are reminded.
    advance(5 * MINUTE, { step: 60_000 });
    const reminded = (key) => server.db.filter('notifications', (row) => row.userId === userId(key) && row.type === 'live.reminder' && row.data.path.endsWith(created.body.id));
    expect(reminded('amira').map((row) => row.data)).toEqual([
      expect.objectContaining({ title: 'Starting in 15 minutes: Sound check-in', body: 'The Physics of Sound. The waiting room is open.' }),
    ]);
    expect(reminded('daniel')).toHaveLength(1);

    expect((await call('POST', `${url}/end`, { token: daniel })).body.error).toMatchObject({ code: 'conflict', message: "This class hasn't started." });
    const started = await call('POST', `${url}/start`, { token: daniel });
    expect(started).toMatchObject({ status: 200, body: { status: 'live', startedAt: new Date(START + 5 * MINUTE).toISOString() } });
    expect((await call('POST', `${url}/start`, { token: daniel })).body.status).toBe('live');
    expect(latest('amira', 'live.started').data).toMatchObject({ title: 'Live now: Sound check-in', body: 'The Physics of Sound. Come in!' });
    expect(sent({ event: 'live:status', live: created.body.id }).at(-1).payload).toMatchObject({ sessionId: created.body.id, status: 'live' });
    expect((await call('POST', `${url}/cancel`, { token: daniel })).body.error.message).toBe('A class that has started can only be ended.');
    expect((await call('DELETE', url, { token: daniel })).body.error.message).toBe('A class that has started stays on record; end it instead.');
    expect((await call('PATCH', url, { token: daniel, body: { startsAt: soon } })).body.error.message).toBe('A class that has started keeps its start time.');
    expect((await call('PATCH', url, { token: daniel, body: { recordingRef: 'kYB8IZa5AuE' } })).body.error.message).toBe('A recording can be added once the class is over.');
    expect((await call('POST', `${url}/start`, { token: amira })).status).toBe(403);

    const ended = await call('POST', `${url}/end`, { token: daniel });
    expect(ended.body).toMatchObject({ status: 'ended', endedAt: expect.any(String) });
    expect((await call('POST', `${url}/end`, { token: daniel })).status).toBe(200);
    expect((await call('POST', `${url}/start`, { token: daniel })).body.error.message).toBe('This class is over.');
    expect((await call('PATCH', url, { token: daniel, body: { streamRef: 'kYB8IZa5AuE' } })).body.error.message).toBe('This class is over: add a recording instead.');
    expect((await call('PATCH', url, { token: daniel, body: { recordingRef: 'https://youtu.be/WUvTyaaNkzM' } })).body.recordingRef).toBe('WUvTyaaNkzM');
    expect((await call('GET', `${live(SOUND)}?when=past`, { token: amira })).body.map((item) => item.id)).toContain(created.body.id);
  });

  it('needs a YouTube stream before going live, cancels, and removes what never happened', async () => {
    const { call, signIn, server } = setup();
    const daniel = await signIn('daniel');
    const created = (await call('POST', live(SOUND), { token: daniel, body: { ...input, streamRef: null } })).body;
    const url = `${live(SOUND)}/${created.id}`;
    expect(created.streamRef).toBeNull();
    expect((await call('POST', `${url}/start`, { token: daniel })).body.error.message).toBe('Add the YouTube stream before going live.');
    expect((await call('PATCH', url, { token: daniel, body: { streamRef: 'not a video' } })).body.error.details).toEqual([
      { path: 'streamRef', message: "That doesn't look like a YouTube video or its address" },
    ]);
    expect((await call('PATCH', url, { token: daniel, body: { streamRef: 'https://www.youtube.com/watch?v=kYB8IZa5AuE', durationMinutes: 60 } })).body).toMatchObject({
      streamRef: 'kYB8IZa5AuE',
      durationMinutes: 60,
    });
    expect((await call('PATCH', url, { token: daniel, body: {} })).status).toBe(400);

    // A new time, a new reminder.
    await call('PATCH', url, { token: daniel, body: { startsAt: '2026-10-02T09:00:00.000Z' } });
    expect(server.db.filter('jobs', (job) => job.type === 'liveReminder' && job.payload.sessionId === created.id).map((job) => new Date(job.at).toISOString())).toEqual([
      '2026-10-02T08:45:00.000Z',
    ]);

    expect((await call('POST', `${url}/cancel`, { token: daniel })).body.status).toBe('cancelled');
    expect((await call('POST', `${url}/cancel`, { token: daniel })).body.status).toBe('cancelled');
    expect(server.db.count('jobs', (job) => job.payload?.sessionId === created.id)).toBe(0);
    expect((await call('POST', `${url}/start`, { token: daniel })).body.error.message).toBe('This class was cancelled.');
    expect((await call('POST', `${url}/end`, { token: daniel })).body.error.message).toBe('This class was cancelled.');
    expect((await call('PATCH', url, { token: daniel, body: { title: 'Back on' } })).body.error.message).toBe('This class was cancelled.');
    expect((await call('DELETE', url, { token: daniel })).status).toBe(204);
    expect((await call('GET', url, { token: daniel })).status).toBe(404);
  });

  it('answers for LiveKit as the API does without it', async () => {
    const { call, signIn } = setup();
    const amira = await signIn('amira');
    expect((await call('POST', `${session(LA, 'office-hours')}/token`, { token: amira })).body.error).toMatchObject({
      code: 'conflict',
      message: "This class's video isn't in the browser.",
    });
    expect((await call('POST', `${session('calculus-first-steps', 'derivatives-drop-in')}/token`, { token: amira })).body.error).toMatchObject({
      code: 'enrollment_required',
      message: 'Enroll in this course to join its live classes.',
    });
  });
});

describe('the room', () => {
  it('lets people in when it’s open: students from 15 minutes before, hosts any time before the end', async () => {
    const { signIn, socket, advance } = setup();
    await signIn('amira');
    const amira = socket('amira');
    const joined = amira.join(OFFICE);
    expect(joined.ok).toBe(true);
    expect(joined.data.session).toMatchObject({ id: OFFICE, status: 'live', canJoin: true });
    const times = joined.data.messages.map((message) => Date.parse(message.createdAt));
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(joined.data.messages.length).toBeGreaterThanOrEqual(8);
    expect(joined.data.messages[0]).toMatchObject({ sessionId: OFFICE, hidden: false, author: { name: 'Priya Raman', host: false } });
    const people = joined.data.attendees;
    expect(people[0]).toMatchObject({ userId: userId('daniel'), host: true });
    expect(people.map((person) => person.userId)).toContain(userId('amira'));
    expect(people.length).toBeGreaterThanOrEqual(6);

    expect(amira.join(DROP_IN)).toEqual({ ok: false, error: { code: 'conflict', message: 'The waiting room opens 15 minutes before the class.' } });
    expect(socket('daniel').join(DROP_IN).ok).toBe(true);
    expect(amira.join(liveId('derivatives-drop-in')).error.code).toBe('enrollment_required');
    expect(socket('lena').join(liveId('derivatives-drop-in')).error).toEqual({ code: 'conflict', message: 'This class was cancelled.' });
    expect(amira.join(liveId('span-qa')).error.message).toBe('This class is over.');
    expect(amira.join(userId('amira')).error.code).toBe('not_found');
    expect(amira.join('nope').error).toEqual({ code: 'validation_failed', message: 'Unknown class.' });
    advance(5 * MINUTE, { step: 30_000 });
    expect(amira.join(DROP_IN).ok).toBe(true);
  });

  it('carries the chat, within limits, and keeps it as a transcript', async () => {
    const { call, signIn, socket, sent, clock } = setup();
    const amira = socket('amira');
    expect(amira.say(OFFICE, 'Hello')).toEqual({ ok: false, error: { code: 'forbidden', message: 'Join the class first.' } });
    amira.join(OFFICE);
    expect(amira.say(OFFICE, '   ').error).toEqual({ code: 'validation_failed', message: 'Write a message' });
    expect(amira.say(OFFICE, 'x'.repeat(501)).error.code).toBe('validation_failed');
    const said = amira.say(OFFICE, '  Could we see the shear again?  ');
    expect(said).toMatchObject({
      ok: true,
      data: { sessionId: OFFICE, body: 'Could we see the shear again?', hidden: false, author: { id: userId('amira'), name: 'Amira Haddad', host: false } },
    });
    expect(sent({ event: 'live:message', live: OFFICE }).at(-1).payload).toEqual(said.data);
    // At most 8 messages in 10 seconds.
    for (let n = 2; n <= 8; n++) {
      clock.now += 500;
      expect(amira.say(OFFICE, `Message ${n}`).ok).toBe(true);
    }
    expect(amira.say(OFFICE, 'One too many')).toEqual({ ok: false, error: { code: 'rate_limited', message: 'Slow down a little: wait a moment before sending more.' } });

    const token = await signIn('amira');
    const history = (await call('GET', `${session(LA, 'office-hours')}/messages?limit=100`, { token })).body;
    expect(history.at(-1).body).toBe('Message 8');
    const earlier = (await call('GET', `${session(LA, 'office-hours')}/messages?limit=3&before=${said.data.id}`, { token })).body;
    expect(earlier).toHaveLength(3);
    expect(earlier.every((message) => Date.parse(message.createdAt) < Date.parse(said.data.createdAt))).toBe(true);
    expect((await call('GET', `${session(LA, 'office-hours')}/messages?before=${userId('amira')}`, { token })).body.error.message).toBe("This message doesn't exist.");
    expect((await call('GET', `${session('calculus-first-steps', 'derivatives-drop-in')}/messages`, { token })).body.error).toMatchObject({
      code: 'enrollment_required',
      message: 'Enroll in this course to join its live classes.',
    });
  });

  it('pages back by time, then id, so messages sent in the same instant aren’t skipped', async () => {
    const { call, signIn, socket, clock } = setup();
    const amira = socket('amira');
    amira.join(OFFICE);
    clock.now += 1000;
    const same = [1, 2, 3, 4].map((n) => amira.say(OFFICE, `Same instant ${n}`).data);
    expect(new Set(same.map((message) => message.createdAt)).size).toBe(1);
    const token = await signIn('amira');
    const url = `${session(LA, 'office-hours')}/messages`;
    const ids = (await call('GET', `${url}?limit=100`, { token })).body.map((message) => message.id).filter((id) => same.some((message) => message.id === id));
    expect(ids).toEqual(same.map((message) => message.id).sort());
    const page = (await call('GET', `${url}?limit=100&before=${ids[2]}`, { token })).body.map((message) => message.id);
    expect(page.slice(-2)).toEqual(ids.slice(0, 2));
    expect(page).not.toContain(ids[2]);
    expect(page).not.toContain(ids[3]);
  });

  it('lets hosts hide a message: its text stays for them, and goes for everyone else', async () => {
    const { call, signIn, socket, sent } = setup();
    const amira = socket('amira');
    amira.join(OFFICE);
    const said = amira.say(OFFICE, 'Off-topic remark').data;
    const daniel = await signIn('daniel');
    const student = await signIn('amira');
    const hide = (token) => call('POST', `${session(LA, 'office-hours')}/messages/${said.id}/hide`, { token });
    expect((await hide(student)).status).toBe(403);
    expect((await hide(daniel)).status).toBe(204);
    expect(sent({ event: 'live:message-hidden', live: OFFICE }).at(-1).payload).toEqual({ sessionId: OFFICE, messageId: said.id });
    expect((await hide(daniel)).status).toBe(204);
    const find = async (token) => (await call('GET', `${session(LA, 'office-hours')}/messages?limit=100`, { token })).body.find((message) => message.id === said.id);
    expect(await find(student)).toMatchObject({ hidden: true, body: '' });
    expect(await find(daniel)).toMatchObject({ hidden: true, body: 'Off-topic remark' });
    expect((await call('POST', `${session(LA, 'office-hours')}/messages/${userId('amira')}/hide`, { token: daniel })).status).toBe(404);

    // The seeded transcript has one hidden too.
    const transcript = (await call('GET', `${session(LA, 'span-qa')}/messages?limit=100`, { token: student })).body;
    expect(transcript.length).toBe(SOCIAL.LIVE[0].transcript.length);
    expect(transcript.filter((message) => message.hidden)).toEqual([expect.objectContaining({ body: '', author: expect.objectContaining({ name: 'Oliver Hughes' }) })]);
  });

  it('raises hands in any class, lets nobody speak without LiveKit, and shows who’s there', async () => {
    const { call, signIn, socket, sent } = setup();
    const amira = socket('amira');
    const daniel = socket('daniel');
    expect(amira.hand(OFFICE, true).error.message).toBe('Join the class first.');
    amira.join(OFFICE);
    daniel.join(OFFICE);
    expect(daniel.hand(OFFICE, true).error).toEqual({ code: 'conflict', message: 'Hosts don’t need to raise a hand.' });
    expect(amira.hand(OFFICE, true)).toEqual({ ok: true, data: undefined });
    const presence = sent({ event: 'live:presence', live: OFFICE }).at(-1).payload;
    expect(presence.attendees.find((person) => person.userId === userId('amira'))).toMatchObject({ handRaised: true, speaker: false, host: false });
    expect(presence.attendees.filter((person) => person.userId === userId('daniel'))).toHaveLength(1);

    const token = await signIn('daniel');
    const speak = (id, allowed) => call('POST', `${session(LA, 'office-hours')}/speakers/${id}`, { token, body: { allowed } });
    // Speaking needs a LiveKit class, which the demo doesn't have: a hand is answered in the chat.
    expect((await speak(userId('amira'), true)).body.error).toMatchObject({ code: 'conflict', message: 'Students can speak only in LiveKit classes.' });
    expect((await speak(userId('amira'), false)).status).toBe(409);
    expect((await speak(userId('amira'), 'yes')).status).toBe(400);
    expect((await call('POST', `${live(SOUND)}/${DROP_IN}/speakers/${userId('amira')}`, { token, body: { allowed: true } })).body.error.message).toBe(
      "The class hasn't started yet.",
    );
    expect(sent({ event: 'live:speaker' })).toEqual([]);
    expect(amira.hand(OFFICE, false).ok).toBe(true);
    expect(
      sent({ event: 'live:presence', live: OFFICE })
        .at(-1)
        .payload.attendees.find((person) => person.userId === userId('amira')),
    ).toMatchObject({ handRaised: false, speaker: false });

    // Not before it starts.
    expect(socket('daniel').join(DROP_IN).ok).toBe(true);
    // Attendance: everyone who came, first joined and last seen.
    const attendance = (await call('GET', `${session(LA, 'office-hours')}/attendance`, { token })).body;
    expect(attendance.find((row) => row.userId === userId('amira'))).toMatchObject({ name: 'Amira Haddad', joinedAt: new Date(START).toISOString() });
    expect((await call('GET', `${session(LA, 'office-hours')}/attendance`, { token: await signIn('amira') })).status).toBe(403);
    expect(amira.leave(OFFICE)).toEqual({ ok: true, data: undefined });
    expect(amira.say(OFFICE, 'Still here?').error.message).toBe('Join the class first.');
  });
});

describe('the scripted classmates', () => {
  it('chat, come and go, and raise hands the host answers in the chat while the visitor is in the room, and stop when they leave', async () => {
    const { signIn, socket, advance, sent, server } = setup();
    await signIn('amira');
    const amira = socket('amira');
    amira.join(OFFICE);
    const scripted = () => sent({ event: 'live:message', live: OFFICE }).filter((message) => message.payload.author?.id !== userId('amira'));
    advance(20_000);
    expect(scripted().length).toBeGreaterThanOrEqual(1);
    advance(4 * MINUTE);
    const said = scripted();
    // Every 8 to 20 seconds.
    expect(said.length).toBeGreaterThanOrEqual(12);
    expect(said.length).toBeLessThanOrEqual(70);
    expect(new Set(said.map((message) => message.payload.author.id)).size).toBeGreaterThanOrEqual(4);
    // Daniel (scripted, as Amira isn't the host) answers some of the questions.
    expect(said.some((message) => message.payload.author.host)).toBe(true);
    const presence = sent({ event: 'live:presence', live: OFFICE }).map((message) => message.payload.attendees);
    expect(presence.some((people) => people.some((person) => person.handRaised))).toBe(true);
    // Nobody ever speaks (no LiveKit): the host calls on a raised hand in the chat, and its question is typed.
    expect(presence.some((people) => people.some((person) => person.speaker))).toBe(false);
    expect(sent({ event: 'live:speaker' })).toEqual([]);
    const called = said.map((message) => message.payload.author.host && calledOn(message.payload.body)).find(Boolean);
    expect(called).toBeTruthy();
    const student = presence.flat().find((person) => person.name.split(' ')[0] === called);
    expect(said.some((message) => message.payload.author.id === student.userId && SOCIAL.LIVE_CHAT.floor.some((prefix) => message.payload.body.startsWith(prefix)))).toBe(true);

    // A question from the visitor gets an answer from the host.
    amira.say(OFFICE, 'Why does the determinant of a reflection come out negative?');
    advance(20_000);
    expect(scripted().some((message) => message.payload.author.host && message.payload.body.includes('Amira'))).toBe(true);

    // The visitor leaves: the room goes quiet.
    amira.leave(OFFICE);
    const count = sent({ event: 'live:message', live: OFFICE }).length;
    const stored = server.db.count('liveMessages', (row) => row.sessionId === OFFICE);
    advance(2 * MINUTE);
    expect(sent({ event: 'live:message', live: OFFICE }).length).toBe(count);
    expect(server.db.count('liveMessages', (row) => row.sessionId === OFFICE)).toBe(stored);
    expect(server.attendees(OFFICE)).toEqual([]);
  });

  it('gather in the waiting room, and arrive when the visitor goes live as host', async () => {
    const { call, signIn, socket, advance, sent } = setup();
    const token = await signIn('daniel');
    const daniel = socket('daniel');
    // Too early for students: only the host.
    daniel.join(DROP_IN);
    advance(MINUTE);
    expect(sent({ event: 'live:message', live: DROP_IN })).toHaveLength(0);
    expect(
      sent({ event: 'live:presence', live: DROP_IN })
        .at(-1)
        .payload.attendees.map((person) => person.userId),
    ).toEqual([userId('daniel')]);
    // From 12:05, students come in, and chat while they wait.
    advance(9 * MINUTE);
    const waiting = sent({ event: 'live:presence', live: DROP_IN }).at(-1).payload.attendees;
    expect(waiting.length).toBeGreaterThan(1);
    expect(waiting.filter((person) => person.host)).toHaveLength(1);
    expect(sent({ event: 'live:message', live: DROP_IN }).length).toBeGreaterThan(0);

    // Going live: students arrive over the next seconds, and greet.
    const before = waiting.length;
    await call('POST', `${live(SOUND)}/${DROP_IN}/start`, { token });
    advance(15_000);
    const now = sent({ event: 'live:presence', live: DROP_IN }).at(-1).payload.attendees;
    expect(now.length).toBeGreaterThanOrEqual(before + 4);
    // A raised hand waits for the host (the visitor) to answer it.
    let raised = null;
    for (let waited = 0; !raised && waited < 5 * MINUTE; waited += 10_000) {
      advance(10_000);
      raised = sent({ event: 'live:presence', live: DROP_IN })
        .at(-1)
        .payload.attendees.find((person) => person.handRaised);
    }
    expect(raised).toBeTruthy();
    expect((await call('POST', `${live(SOUND)}/${DROP_IN}/speakers/${raised.userId}`, { token, body: { allowed: true } })).body.error.message).toBe(
      'Students can speak only in LiveKit classes.',
    );
    // The host answers in the chat, by name: the hand comes down, and the question is typed.
    daniel.say(DROP_IN, `Go ahead, ${raised.name.split(' ')[0]}: what’s your question?`);
    expect(
      sent({ event: 'live:presence', live: DROP_IN })
        .at(-1)
        .payload.attendees.find((person) => person.userId === raised.userId),
    ).toMatchObject({ handRaised: false, speaker: false });
    advance(10_000);
    expect(
      sent({ event: 'live:message', live: DROP_IN }).some(
        (message) => message.payload.author.id === raised.userId && SOCIAL.LIVE_CHAT.floor.some((prefix) => message.payload.body.startsWith(prefix)),
      ),
    ).toBe(true);

    // Ending the class: the status goes out, the room empties of classmates, the transcript stays.
    await call('POST', `${live(SOUND)}/${DROP_IN}/end`, { token });
    expect(sent({ event: 'live:status', live: DROP_IN }).at(-1).payload).toMatchObject({ status: 'ended' });
    expect(
      sent({ event: 'live:presence', live: DROP_IN })
        .at(-1)
        .payload.attendees.map((person) => person.userId),
    ).toEqual([userId('daniel')]);
    const transcript = (await call('GET', `${live(SOUND)}/${DROP_IN}/messages?limit=100`, { token })).body;
    expect(transcript.length).toBeGreaterThan(3);
  });

  it('start a seeded class on time when the visitor isn’t its host', async () => {
    const student = setup();
    await student.signIn('amira');
    student.advance(20 * MINUTE, { step: 60_000 });
    expect(student.server.db.get('liveSessions', DROP_IN)).toMatchObject({ status: 'live', startedAt: START + 20 * MINUTE });
    const told = student.server.db
      .filter('notifications', (row) => row.userId === userId('amira') && (row.type === 'live.reminder' || row.type === 'live.started'))
      .map((row) => row.data.title);
    expect(told).toEqual(expect.arrayContaining(['Starting in 15 minutes: Drop-in: beat lab questions', 'Live now: Drop-in: beat lab questions']));

    // The host's own class waits for them.
    const host = setup();
    await host.signIn('daniel');
    host.advance(20 * MINUTE, { step: 60_000 });
    expect(host.server.db.get('liveSessions', DROP_IN).status).toBe('scheduled');
  });

  it('end a seeded class on time, with a goodbye, when the visitor isn’t its host', async () => {
    const student = setup();
    await student.signIn('amira');
    student.socket('amira').join(OFFICE);
    student.advance(50 * MINUTE, { step: 30_000 });
    expect(student.server.db.get('liveSessions', OFFICE)).toMatchObject({ status: 'ended', endedAt: START + 50 * MINUTE });
    expect(student.sent({ event: 'live:status', live: OFFICE }).at(-1).payload).toMatchObject({ status: 'ended' });
    const last = student.sent({ event: 'live:message', live: OFFICE }).at(-1).payload;
    expect(last).toMatchObject({ author: { name: 'Daniel Okafor', host: true } });
    expect(SOCIAL.LIVE_CHAT.closings).toContain(last.body);
    // The drop-in started at 12:20, and ends at 13:05.
    student.advance(15 * MINUTE, { step: 60_000 });
    expect(student.server.db.get('liveSessions', DROP_IN)).toMatchObject({ status: 'ended', endedAt: START + 65 * MINUTE });

    // The host's own classes are theirs to end.
    const host = setup();
    await host.signIn('daniel');
    host.advance(55 * MINUTE, { step: 60_000 });
    expect(host.server.db.get('liveSessions', OFFICE).status).toBe('live');
  });

  it('close classes left behind, as the worker does', async () => {
    const { server, advance, signIn } = setup();
    // Daniel runs these classes, so nobody scripted starts or ends them.
    await signIn('daniel');
    // The drop-in was due 12:20 to 13:05: two hours after that, it's cancelled; the office hours, ended.
    advance(65 * MINUTE + STALE_LIVE_MS + MINUTE, { step: 5 * MINUTE });
    expect(server.db.get('liveSessions', OFFICE)).toMatchObject({ status: 'ended' });
    expect(server.db.get('liveSessions', DROP_IN)).toMatchObject({ status: 'cancelled' });
  });
});

describe('saved state', () => {
  it('keeps the visitor’s classes, chat and status changes, and resets to the seed', async () => {
    const storage = memoryStorage();
    const clock = { now: START };
    const first = setup({ storage, clock });
    const token = await first.signIn('daniel');
    first.socket('daniel').join(OFFICE);
    const said = first.socket('daniel').say(OFFICE, 'That’s all for today, thanks everyone!').data;
    await first.call('POST', `${live(LA)}/${OFFICE}/end`, { token });
    const scheduled = (
      await first.call('POST', live(SOUND), {
        token,
        body: { title: 'Tuning by ear', startsAt: '2026-10-02T17:00:00.000Z', durationMinutes: 30, provider: 'link', streamRef: 'https://meet.example.com/tuning' },
      })
    ).body;
    expect(storage.get(STORAGE_KEY).length).toBeLessThan(60_000);

    // A reload: the same.
    clock.now += 10 * MINUTE;
    const second = setup({ storage, clock });
    const again = await second.signIn('daniel');
    expect((await second.call('GET', `${live(LA)}/${OFFICE}`, { token: again })).body.status).toBe('ended');
    expect((await second.call('GET', `${live(LA)}/${OFFICE}/messages?limit=100`, { token: again })).body.map((message) => message.id)).toContain(said.id);
    expect((await second.call('GET', `${live(SOUND)}/${scheduled.id}`, { token: again })).body.title).toBe('Tuning by ear');

    // Reset: the office hours are live again (a new occurrence, from now), and the rest is gone.
    second.server.reset();
    const fresh = await second.signIn('daniel');
    const office = liveId('office-hours', clock.now);
    expect((await second.call('GET', `${live(LA)}/${OFFICE}`, { token: fresh })).status).toBe(404);
    expect((await second.call('GET', `${live(LA)}/${office}`, { token: fresh })).body.status).toBe('live');
    expect((await second.call('GET', `${live(LA)}/${office}/messages?limit=100`, { token: fresh })).body.map((message) => message.id)).not.toContain(said.id);
    expect((await second.call('GET', `${live(SOUND)}/${scheduled.id}`, { token: fresh })).status).toBe(404);
  });
});

describe('returning visitors', () => {
  const DAY = 86_400_000;
  const getClass = (visit, token, key, occurrence) => visit.call('GET', `${live(key === 'drop' ? SOUND : LA)}/${liveId(key === 'drop' ? 'sound-drop-in' : key, occurrence)}`, { token });

  it('find the seeded classes the same on every reload of a visit, and afresh on a later one', async () => {
    const storage = memoryStorage();
    const clock = { now: START };
    const first = setup({ storage, clock });
    await first.signIn('amira');
    first.socket('amira').join(OFFICE);
    const said = first.socket('amira').say(OFFICE, 'Hello from the first visit').data;
    first.advance(25 * MINUTE, { step: 60_000 });
    expect(first.server.occurrence()).toMatchObject({ occurrence: START, ends: START + 65 * MINUTE });
    expect(first.server.db.get('liveSessions', DROP_IN).status).toBe('live');

    // A reload within the visit: the same classes, times, chat, and what happened on its own.
    clock.now = START + 30 * MINUTE;
    const second = setup({ storage, clock });
    let token = await second.signIn('amira');
    const office = (await getClass(second, token, 'office-hours', START)).body;
    expect(office).toMatchObject({ id: OFFICE, status: 'live', startsAt: '2026-10-01T11:50:00.000Z' });
    expect((await second.call('GET', `${live(LA)}/${OFFICE}/messages?limit=100`, { token })).body.map((message) => message.id)).toContain(said.id);
    expect((await getClass(second, token, 'drop', START)).body.status).toBe('live');

    // The next day: the seeded classes as the seed has them, from now; the old occurrence and
    // Amira's chat in it, which she didn't change, are gone, with what pointed at them.
    clock.now = START + DAY;
    const third = setup({ storage, clock });
    token = await third.signIn('amira');
    expect(third.server.occurrence().occurrence).toBe(START + DAY);
    expect((await getClass(third, token, 'office-hours', START + DAY)).body).toMatchObject({ status: 'live', startsAt: '2026-10-02T11:50:00.000Z' });
    expect((await getClass(third, token, 'drop', START + DAY)).body).toMatchObject({ status: 'scheduled', startsAt: '2026-10-02T12:20:00.000Z' });
    expect((await getClass(third, token, 'office-hours', START)).status).toBe(404);
    expect(third.server.db.find('liveMessages', (row) => row.id === said.id)).toBeNull();
    expect(JSON.parse(storage.get(STORAGE_KEY)).tables.liveMessages ?? {}).toEqual({});
    const pointers = third.server.db.filter('notifications', (row) => row.userId === userId('amira') && /\/live\//.test(row.data.path));
    expect(pointers.every((row) => third.server.db.get('liveSessions', row.data.path.split('/').at(-1)))).toBe(true);
    const upcoming = (await third.call('GET', '/schools/grand-academy/live', { token })).body.map((item) => item.title);
    expect(upcoming.filter((title) => title === 'Office hours: transformations and the determinant')).toHaveLength(1);
  });

  it('keep what the visitor changed themselves, with its whole chat, and seeded classes they deleted stay deleted', async () => {
    const storage = memoryStorage();
    const clock = { now: START };
    const first = setup({ storage, clock });
    const token = await first.signIn('daniel');
    first.socket('daniel').join(OFFICE);
    const said = first.socket('daniel').say(OFFICE, 'That’s all for today!').data;
    await first.call('POST', `${live(LA)}/${OFFICE}/end`, { token });
    expect((await first.call('DELETE', `${live('calculus-first-steps')}/${liveId('derivatives-drop-in')}`, { token })).status).toBe(204);
    // He starts the drop-in early and leaves it running.
    expect((await first.call('POST', `${live(SOUND)}/${DROP_IN}/start`, { token })).body.status).toBe('live');
    const mine = (await first.call('POST', live(SOUND), { token, body: { title: 'Tuning by ear', startsAt: '2026-10-05T17:00:00.000Z', durationMinutes: 30, provider: 'link', streamRef: 'https://meet.example.com/tuning' } })).body;
    // Lena moves Omar's workshop: still to come on the next visit, so it isn't seeded twice.
    const lena = await first.signIn('lena');
    await first.call('PATCH', `${live('first-civilizations')}/${liveId('rivers-seminar')}`, { token: lena, body: { description: 'Bring a draft.' } });

    clock.now = START + DAY;
    const next = setup({ storage, clock });
    const again = await next.signIn('daniel');
    // His ended office hours stay, as he left them, with the seeded transcript and his goodbye.
    const kept = (await next.call('GET', `${live(LA)}/${OFFICE}`, { token: again })).body;
    expect(kept).toMatchObject({ status: 'ended', endedAt: new Date(START).toISOString(), startsAt: '2026-10-01T11:50:00.000Z' });
    const transcript = (await next.call('GET', `${live(LA)}/${OFFICE}/messages?limit=100`, { token: again })).body;
    expect(transcript.length).toBeGreaterThanOrEqual(SOCIAL.LIVE[1].transcript.length + 1);
    expect(transcript.at(-1).id).toBe(said.id);
    // Today's office hours are on, as seeded.
    expect((await next.call('GET', `${live(LA)}/${liveId('office-hours', START + DAY)}`, { token: again })).body.status).toBe('live');
    expect((await next.call('GET', `${live(LA)}?when=past`, { token: again })).body.map((item) => item.id)).toContain(OFFICE);
    // The drop-in he left running ended as planned, and today's is seeded afresh.
    expect((await next.call('GET', `${live(SOUND)}/${DROP_IN}`, { token: again })).body).toMatchObject({ status: 'ended', endedAt: new Date(START + 65 * MINUTE).toISOString() });
    expect((await next.call('GET', `${live(SOUND)}/${liveId('sound-drop-in', START + DAY)}`, { token: again })).body.status).toBe('scheduled');
    // Deleted stays deleted; his own class stays.
    expect((await next.call('GET', `${live('calculus-first-steps')}/${liveId('derivatives-drop-in', START + DAY)}`, { token: again })).status).toBe(404);
    expect((await next.call('GET', `${live(SOUND)}/${mine.id}`, { token: again })).body.title).toBe('Tuning by ear');
    // One workshop: Lena's edited one.
    const workshops = (await next.call('GET', `${live('first-civilizations')}`, { token: await next.signIn('lena') })).body;
    expect(workshops.map((item) => item.id)).toEqual([liveId('rivers-seminar')]);
    expect(workshops[0]).toMatchObject({ description: 'Bring a draft.', startsAt: '2026-10-03T12:00:00.000Z' });
  });
});

/** The first name the host called on, if this is a call on a raised hand ("Go ahead, Priya: …"). */
function calledOn(body) {
  for (const template of SOCIAL.LIVE_CHAT.handCalls) {
    const [before, after] = template.split('{name}');
    if (body.startsWith(before) && body.endsWith(after)) return body.slice(before.length, body.length - after.length);
  }
  return null;
}
