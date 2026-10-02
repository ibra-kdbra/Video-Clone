import { describe, expect, it } from 'vitest';

import { audibleParticipants, connectionNotice, mediaControls, needsNewToken, stageLayout, videoEntries } from '../src/lib/livekitLayout.js';

const camera = (sid, muted = false) => ({ sid, source: 'camera', kind: 'video', muted });
const screen = (sid) => ({ sid, source: 'screen_share', kind: 'video', muted: false });
const mic = (sid, muted = false) => ({ sid, source: 'microphone', kind: 'audio', muted });
const person = (identity, name, tracks, extra = {}) => ({ identity, name, tracks, isLocal: false, isHost: false, ...extra });

describe('a LiveKit class’s screen', () => {
  it('shows the host’s camera large, and speakers small', () => {
    const layout = stageLayout([
      person('s1', 'Zoe', [camera('c1'), mic('m1')]),
      person('h', 'Maya', [camera('c2'), mic('m2')], { isHost: true }),
      person('s2', 'Ali', [camera('c3')]),
    ]);
    expect(layout.main).toMatchObject({ identity: 'h', source: 'camera' });
    expect(layout.side.map((entry) => entry.name)).toEqual(['Ali', 'Zoe']);
  });

  it('puts a shared screen large, the host’s before anyone else’s, with the host’s camera small', () => {
    const layout = stageLayout([person('s1', 'Zoe', [screen('x1')]), person('h', 'Maya', [camera('c2'), screen('x2')], { isHost: true })]);
    expect(layout.main).toMatchObject({ identity: 'h', source: 'screen_share' });
    expect(layout.side.map((entry) => entry.key)).toEqual(['h:camera', 's1:screen_share']);
    expect(stageLayout([person('s1', 'Zoe', [screen('x1')]), person('h', 'Maya', [camera('c2')], { isHost: true })]).main.key).toBe('s1:screen_share');
  });

  it('leaves out muted cameras and audio, and puts my own picture last', () => {
    const participants = [
      person('me', 'Amira', [camera('c0')], { isLocal: true }),
      person('h', 'Maya', [camera('c1', true), mic('m1')], { isHost: true }),
      person('s2', 'Ali', [camera('c3')]),
    ];
    expect(videoEntries(participants).map((entry) => entry.key)).toEqual(['me:camera', 's2:camera']);
    const layout = stageLayout(participants);
    expect(layout.main.key).toBe('s2:camera');
    expect(layout.side.map((entry) => entry.key)).toEqual(['me:camera']);
    expect(audibleParticipants(participants).map((p) => p.identity)).toEqual(['h']);
  });

  it('lets a picture be pinned large while it’s there', () => {
    const participants = [person('h', 'Maya', [camera('c1')], { isHost: true }), person('s2', 'Ali', [camera('c3')])];
    expect(stageLayout(participants, { pinned: 's2:camera' }).main.key).toBe('s2:camera');
    expect(stageLayout(participants, { pinned: 'gone:camera' }).main.key).toBe('h:camera');
  });

  it('is empty with no pictures', () => {
    expect(stageLayout([])).toEqual({ main: null, side: [] });
    expect(stageLayout(undefined)).toEqual({ main: null, side: [] });
  });
});

describe('who gets the camera, microphone and screen', () => {
  it('gives hosts all three, invited speakers camera and microphone, and others none', () => {
    expect(mediaControls({ canHost: true, canPublish: true })).toEqual({ camera: true, microphone: true, screen: true });
    expect(mediaControls({ canHost: false, speaker: true, canPublish: true })).toEqual({ camera: true, microphone: true, screen: false });
    expect(mediaControls({ canHost: false, speaker: false, canPublish: false })).toEqual({ camera: false, microphone: false, screen: false });
    // Invited, but this connection can't publish yet: nothing until it can.
    expect(mediaControls({ canHost: false, speaker: true, canPublish: false })).toEqual({ camera: false, microphone: false, screen: false });
  });

  it('asks for a new token when the right to speak and the connection’s rights disagree', () => {
    expect(needsNewToken({ speaker: true, canPublish: false })).toBe(true);
    expect(needsNewToken({ speaker: false, canPublish: true })).toBe(true);
    expect(needsNewToken({ speaker: true, canPublish: true })).toBe(false);
    expect(needsNewToken({ speaker: false, canPublish: false, canHost: true })).toBe(false);
  });

  it('says what’s happening with the connection', () => {
    expect(connectionNotice('connected')).toBeNull();
    expect(connectionNotice('reconnecting').tone).toBe('warning');
    expect(connectionNotice('disconnected').tone).toBe('danger');
    expect(connectionNotice('connecting').text).toMatch(/Connecting/);
  });
});
