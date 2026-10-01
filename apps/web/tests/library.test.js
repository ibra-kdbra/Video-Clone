import { beforeAll, describe, expect, it, vi } from 'vitest';

/** An in-memory localStorage, with a list saved by the previous version of the app. */
const memory = new Map([
  [
    'fundastream_watch_later',
    JSON.stringify([
      { id: { videoId: 'aaaaaaaaaaa' }, snippet: { title: 'Old save', channelId: 'UCaaaaaaaaaaaaaaaaaaaaaa', channelTitle: 'Old channel', thumbnails: { high: { url: 'https://i.ytimg.com/vi/a/hq.jpg' } } } },
      { id: 'bbbbbbbbbbb', snippet: { title: 'Second' } },
      { id: { videoId: 'not valid!' }, snippet: { title: 'Dropped' } },
    ]),
  ],
]);
vi.stubGlobal('localStorage', {
  getItem: (key) => (memory.has(key) ? memory.get(key) : null),
  setItem: (key, value) => memory.set(key, String(value)),
  removeItem: (key) => memory.delete(key),
});
vi.stubGlobal('window', { addEventListener() {} });

let lib;
beforeAll(async () => {
  lib = await import('../src/lib/library.js');
});

const video = (id, extra = {}) => ({ provider: 'youtube', id, title: `Video ${id}`, thumbnail: 'https://i.ytimg.com/x.jpg', channel: { id: 'UCaaaaaaaaaaaaaaaaaaaaaa', title: 'C' }, ...extra });

describe('stored entries are validated', () => {
  it.each([
    ['an unknown platform', { provider: 'evil', id: 'x' }],
    ['a malformed id', { provider: 'youtube', id: '../../etc' }],
    ['no id', { provider: 'dailymotion' }],
    ['not an object', 'garbage'],
  ])('rejects %s', (_label, input) => expect(lib.toEntry(input)).toBeNull());

  it('drops unsafe image URLs and bad channel ids, and caps text', () => {
    const entry = lib.toEntry(video('ccccccccccc', { thumbnail: 'javascript:alert(1)', title: 'x'.repeat(400), channel: { id: '<script>', title: 'C' } }));
    expect(entry.thumbnail).toBeNull();
    expect(entry.channel.id).toBeNull();
    expect(entry.title).toHaveLength(300);
  });

  it('keeps only known fields', () => {
    const entry = lib.toEntry({ ...video('ddddddddddd'), secret: 'x', __proto__: { polluted: true } });
    expect(Object.keys(entry).sort()).toEqual(['at', 'channel', 'duration', 'id', 'provider', 'publishedAt', 'thumbnail', 'thumbnails', 'title', 'views']);
  });
});

describe('migration from the previous version', () => {
  it('carries old Watch Later items over and removes the old key', () => {
    const saved = JSON.parse(memory.get('fs.saved.v2'));
    expect(saved.map((item) => item.id)).toEqual(['aaaaaaaaaaa', 'bbbbbbbbbbb']);
    expect(saved[0].channel).toEqual({ id: 'UCaaaaaaaaaaaaaaaaaaaaaa', title: 'Old channel' });
    expect(memory.has('fundastream_watch_later')).toBe(false);
  });
});

describe('library actions', () => {
  it('adds to the top without duplicates', () => {
    lib.library.clear('history');
    lib.library.add('history', video('eeeeeeeeeee'));
    lib.library.add('history', video('fffffffffff'));
    lib.library.add('history', video('eeeeeeeeeee'));
    expect(JSON.parse(memory.get('fs.history.v2')).map((item) => item.id)).toEqual(['eeeeeeeeeee', 'fffffffffff']);
  });

  it('refuses invalid videos', () => expect(lib.library.add('history', { provider: 'youtube', id: 'bad' })).toBe(false));

  it('toggles saved', () => {
    const v = video('ggggggggggg');
    expect(lib.library.toggleSaved(v)).toBe(true);
    expect(lib.library.has('saved', v)).toBe(true);
    expect(lib.library.toggleSaved(v)).toBe(false);
    expect(lib.library.has('saved', v)).toBe(false);
  });

  it('keeps history to 100 entries', () => {
    lib.library.clear('history');
    for (let i = 0; i < 120; i++) lib.library.add('history', video(`h${String(i).padStart(10, '0')}`));
    expect(JSON.parse(memory.get('fs.history.v2'))).toHaveLength(100);
  });
});
