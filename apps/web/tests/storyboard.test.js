import { describe, expect, it } from 'vitest';

import { cueAt, parseStoryboard, parseTimestamp, spriteSheets } from '../src/lib/storyboard.js';

const BASE = 'https://lms.example.com/api/v1/media/s1/a1/storyboard.vtt?t=123';

// As the API serves it: the worker's file, its image names swapped for signed store addresses.
const VTT = `WEBVTT

00:00:00.000 --> 00:00:02.000
https://media.example.com/grand-media/s1/a1/hls/storyboard-0.jpg?X-Amz-Signature=abc&X-Amz-Expires=3600#xywh=0,0,160,90

00:00:02.000 --> 00:00:04.000
https://media.example.com/grand-media/s1/a1/hls/storyboard-0.jpg?X-Amz-Signature=abc&X-Amz-Expires=3600#xywh=160,0,160,90

00:00:04.000 --> 00:00:06.000
https://media.example.com/grand-media/s1/a1/hls/storyboard-0.jpg?X-Amz-Signature=abc&X-Amz-Expires=3600#xywh=320,0,160,90

01:00:00.500 --> 01:00:02.000
storyboard-1.jpg#xywh=0,90,160,90
`;

describe('storyboard timestamps', () => {
  it.each([
    ['00:00:02.000', 2],
    ['01:02:03.500', 3723.5],
    ['02:03.25', 123.25],
    ['00:00:00,100', 0.1],
    ['nonsense', Number.NaN],
  ])('%s → %s', (text, seconds) => expect(parseTimestamp(text)).toBe(seconds));
});

describe('parsing a storyboard', () => {
  const cues = parseStoryboard(VTT, BASE);

  it('reads each cue: its time range, sprite address and the thumbnail inside it', () => {
    expect(cues).toHaveLength(4);
    expect(cues[1]).toEqual({
      start: 2,
      end: 4,
      url: 'https://media.example.com/grand-media/s1/a1/hls/storyboard-0.jpg?X-Amz-Signature=abc&X-Amz-Expires=3600',
      x: 160,
      y: 0,
      width: 160,
      height: 90,
    });
  });

  it('resolves relative image names against the storyboard’s own address', () => {
    expect(cues[3]).toMatchObject({ start: 3600.5, url: 'https://lms.example.com/api/v1/media/s1/a1/storyboard-1.jpg', y: 90 });
  });

  it('lists the sprite sheets once each, to preload', () => {
    expect(spriteSheets(cues)).toHaveLength(2);
  });

  it('skips what it can’t read, and anything that isn’t an http(s) image', () => {
    const odd = `WEBVTT\r\n\r\n00:00:00.000 --> 00:00:02.000\r\njavascript:alert(1)#xywh=0,0,160,90\r\n\r\n00:00:02.000 --> 00:00:01.000\r\nx.jpg#xywh=0,0,160,90\r\n\r\n00:00:04.000 --> 00:00:06.000\r\nno-fragment.jpg\r\n\r\n00:00:06.000 --> 00:00:08.000\r\nok.jpg#xywh=0,0,160,90\r\n`;
    expect(parseStoryboard(odd, BASE).map((cue) => cue.url)).toEqual(['https://lms.example.com/api/v1/media/s1/a1/ok.jpg']);
    expect(parseStoryboard('not a vtt', BASE)).toEqual([]);
    expect(parseStoryboard(null, BASE)).toEqual([]);
  });
});

describe('finding the thumbnail for a moment', () => {
  const cues = parseStoryboard(VTT, BASE);

  it.each([
    [0, 0],
    [1.99, 0],
    [2, 160],
    [5.5, 320],
    // Between cues and past the end: the last one that started.
    [100, 320],
  ])('at %s s → x=%s', (time, x) => expect(cueAt(cues, time).x).toBe(x));

  it('handles before the first cue and no cues', () => {
    expect(cueAt(cues, -3)).toBe(cues[0]);
    expect(cueAt([], 3)).toBeNull();
    expect(cueAt(cues, Number.NaN)).toBeNull();
  });
});
