import { describe, expect, it, vi } from 'vitest';

import { checkVideoFile, createMeter, partsFor, uploadName, uploadVideo, videoContentType } from '../src/lib/upload.js';

/**
 * The multipart upload client (src/lib/upload.js) against a fake video store: XMLHttpRequest is
 * replaced by FakeRequest, whose answers come from `respond(request)`, and the API calls are
 * spies. No network, no real timers for the retry pauses (`wait` resolves at once).
 */

const MB = 1024 * 1024;

class FakeStore {
  constructor(respond) {
    this.respond = respond;
    this.requests = [];
    this.active = 0;
    this.maxActive = 0;
  }

  create = () => new FakeRequest(this);
}

class FakeRequest {
  constructor(store) {
    this.store = store;
    this.upload = {};
    this.headers = {};
  }

  open(method, url) {
    this.method = method;
    this.url = url;
  }

  send(body) {
    this.body = body;
    const { store } = this;
    store.requests.push(this);
    store.active += 1;
    store.maxActive = Math.max(store.maxActive, store.active);
    // Answers arrive later, so several parts are in flight at once.
    setTimeout(() => {
      if (this.aborted) return;
      store.active -= 1;
      const answer = store.respond(this);
      if (answer === 'hang') {
        store.active += 1;
        return;
      }
      if (answer.network) return this.onerror?.();
      this.upload.onprogress?.({ loaded: body.size, total: body.size });
      this.status = answer.status;
      this.headers = answer.headers ?? {};
      this.onload?.();
    }, 1);
  }

  abort() {
    if (this.aborted) return;
    this.aborted = true;
    this.store.active -= 1;
    this.onabort?.();
  }

  getResponseHeader(name) {
    return this.headers[name.toLowerCase()] ?? null;
  }
}

const partNumberOf = (url) => Number(new URL(url).searchParams.get('partNumber'));
const ok = (request) => ({ status: 200, headers: { etag: `"etag-${partNumberOf(request.url)}"` } });

function setup({ size = 40 * MB, partSize = 16 * MB, respond = ok } = {}) {
  const file = new File([new Uint8Array(size)], 'Lesson 1.mp4', { type: 'video/mp4' });
  const count = Math.ceil(size / partSize);
  const signed = (partNumber, round = 1) => ({ partNumber, url: `https://media.example.com/original?partNumber=${partNumber}&round=${round}` });
  const api = {
    start: vi.fn(async () => ({
      assetId: 'asset-1',
      partSize,
      parts: Array.from({ length: count }, (_, i) => signed(i + 1)),
      expiresAt: '2026-10-01T12:00:00Z',
    })),
    moreParts: vi.fn(async (_assetId, partNumbers) => ({ parts: partNumbers.map((n) => signed(n, 2)), expiresAt: '2026-10-01T13:00:00Z' })),
    complete: vi.fn(async (_assetId, parts) => ({ id: 'lesson-1', video: { provider: 'upload', status: 'processing', parts } })),
    cancel: vi.fn(async () => null),
  };
  const store = new FakeStore(respond);
  const wait = vi.fn(async () => {});
  return { file, api, store, wait, options: { api, createRequest: store.create, wait, backoff: (attempt) => 100 * 2 ** attempt } };
}

describe('splitting a file into parts', () => {
  it('cuts it by the part size, the last part taking the rest', () => {
    expect(partsFor(40 * MB, 16 * MB)).toEqual([
      { partNumber: 1, start: 0, end: 16 * MB },
      { partNumber: 2, start: 16 * MB, end: 32 * MB },
      { partNumber: 3, start: 32 * MB, end: 40 * MB },
    ]);
    expect(partsFor(32 * MB, 16 * MB)).toHaveLength(2);
    expect(partsFor(1000, 16 * MB)).toEqual([{ partNumber: 1, start: 0, end: 1000 }]);
  });
});

describe('uploading', () => {
  it('sends every part, at most three at a time, then completes with their ETags in order', async () => {
    const { file, api, store, options } = setup({ size: 100 * MB });
    const result = await uploadVideo(file, options);

    expect(api.start).toHaveBeenCalledWith({ fileName: 'Lesson 1.mp4', size: 100 * MB, contentType: 'video/mp4' });
    expect(store.requests).toHaveLength(7);
    expect(store.maxActive).toBe(3);
    expect(store.requests.every((request) => request.method === 'PUT')).toBe(true);
    // Each part carries exactly its slice of the file.
    const sizes = Object.fromEntries(store.requests.map((request) => [partNumberOf(request.url), request.body.size]));
    expect(sizes).toEqual({ 1: 16 * MB, 2: 16 * MB, 3: 16 * MB, 4: 16 * MB, 5: 16 * MB, 6: 16 * MB, 7: 4 * MB });
    expect(api.complete).toHaveBeenCalledWith(
      'asset-1',
      Array.from({ length: 7 }, (_, i) => ({ partNumber: i + 1, etag: `"etag-${i + 1}"` })),
    );
    expect(api.cancel).not.toHaveBeenCalled();
    expect(result.video.status).toBe('processing');
  });

  it('reports progress up to the whole file, and its phases', async () => {
    const { file, options } = setup({ size: 40 * MB });
    const progress = [];
    const phases = [];
    await uploadVideo(file, { ...options, onProgress: (value) => progress.push(value), onPhase: (phase) => phases.push(phase) });
    expect(progress.at(-1)).toMatchObject({ loaded: 40 * MB, total: 40 * MB });
    expect(progress.every((value) => value.loaded <= value.total)).toBe(true);
    expect(phases).toEqual(['uploading', 'finishing']);
  });

  it('retries a failing part with growing pauses, up to three times', async () => {
    const failures = new Map();
    const { file, api, wait, options } = setup({
      respond: (request) => {
        const part = partNumberOf(request.url);
        const count = failures.get(part) ?? 0;
        if (part === 2 && count < 3) {
          failures.set(part, count + 1);
          return count === 0 ? { network: true } : { status: 503 };
        }
        return ok(request);
      },
    });
    await uploadVideo(file, options);
    expect(failures.get(2)).toBe(3);
    expect(wait.mock.calls.map(([ms]) => ms)).toEqual([100, 200, 400]);
    expect(api.complete).toHaveBeenCalledTimes(1);
  });

  it('gives up after the retries, stops the other parts and cancels the upload on the server', async () => {
    const { file, api, store, options } = setup({ size: 64 * MB, respond: (request) => (partNumberOf(request.url) === 1 ? { status: 500 } : 'hang') });
    await expect(uploadVideo(file, options)).rejects.toThrow(/kept failing/);
    expect(store.requests.filter((request) => partNumberOf(request.url) === 1)).toHaveLength(4);
    // The parts still in flight were stopped.
    expect(store.requests.filter((request) => partNumberOf(request.url) !== 1).every((request) => request.aborted)).toBe(true);
    expect(api.complete).not.toHaveBeenCalled();
    expect(api.cancel).toHaveBeenCalledWith('asset-1');
  });

  it('asks for fresh addresses when the store says they expired (403), once for all the parts that need them', async () => {
    const { file, api, store, options } = setup({
      size: 48 * MB,
      respond: (request) => (request.url.includes('round=1') && partNumberOf(request.url) > 1 ? { status: 403 } : ok(request)),
    });
    await uploadVideo(file, options);
    expect(api.moreParts).toHaveBeenCalledTimes(1);
    // Only parts not yet sent are re-signed.
    expect(api.moreParts.mock.calls[0]).toEqual(['asset-1', expect.not.arrayContaining([1])]);
    const resent = store.requests.filter((request) => request.url.includes('round=2')).map((request) => partNumberOf(request.url));
    expect(resent.sort()).toEqual([2, 3]);
    expect(api.complete.mock.calls[0][1].map((part) => part.etag)).toEqual(['"etag-1"', '"etag-2"', '"etag-3"']);
  });

  it('fails when the store answers without an ETag (CORS not exposing it)', async () => {
    const { file, api, options } = setup({ size: 1 * MB, respond: () => ({ status: 200, headers: {} }) });
    await expect(uploadVideo(file, options)).rejects.toThrow();
    expect(api.complete).not.toHaveBeenCalled();
    expect(api.cancel).toHaveBeenCalledWith('asset-1');
  });

  it('cancels: in-flight parts are aborted, the server is told, and nothing completes', async () => {
    const controller = new AbortController();
    const { file, api, store, options } = setup({ size: 64 * MB, respond: () => 'hang' });
    const upload = uploadVideo(file, { ...options, signal: controller.signal });
    await vi.waitFor(() => expect(store.requests).toHaveLength(3));
    controller.abort();
    await expect(upload).rejects.toMatchObject({ name: 'AbortError' });
    expect(store.requests.every((request) => request.aborted)).toBe(true);
    expect(api.cancel).toHaveBeenCalledWith('asset-1');
    expect(api.complete).not.toHaveBeenCalled();
  });

  it('cancels right after starting when the abort came while the server was answering', async () => {
    const controller = new AbortController();
    const { file, api, store, options } = setup();
    api.start.mockImplementationOnce(async () => {
      controller.abort();
      return { assetId: 'asset-1', partSize: 16 * MB, parts: [], expiresAt: '' };
    });
    await expect(uploadVideo(file, { ...options, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(store.requests).toHaveLength(0);
    expect(api.cancel).toHaveBeenCalledWith('asset-1');
  });
});

describe('checking a file before sending it', () => {
  const file = (name, type, size = 10) => ({ name, type, size });

  it('knows the video types, from the browser or from the extension', () => {
    expect(videoContentType(file('a.mp4', 'video/mp4'))).toBe('video/mp4');
    expect(videoContentType(file('talk.MKV', ''))).toBe('video/x-matroska');
    expect(videoContentType(file('clip.mov', ''))).toBe('video/quicktime');
    expect(videoContentType(file('notes.pdf', 'application/pdf'))).toBeNull();
  });

  it('refuses the wrong type, files over the limit, and files that need more room than is left', () => {
    const format = (bytes) => `${bytes / MB} MB`;
    expect(checkVideoFile(file('notes.pdf', 'application/pdf'))).toMatch(/MP4, MOV, WebM or MKV/);
    expect(checkVideoFile(file('big.mp4', 'video/mp4', 300 * MB), { maxUploadBytes: 200 * MB, format })).toBe(
      'Videos can be up to 200 MB; this one is 300 MB.',
    );
    expect(checkVideoFile(file('a.mp4', 'video/mp4', 50 * MB), { maxUploadBytes: 200 * MB, freeBytes: 20 * MB, format })).toMatch(
      /20 MB of video storage left/,
    );
    expect(checkVideoFile(file('a.mp4', 'video/mp4', 0))).toMatch(/empty/);
    expect(checkVideoFile(file('a.mp4', 'video/mp4', 5 * MB), { maxUploadBytes: 200 * MB, freeBytes: 20 * MB })).toBeNull();
  });

  it('cleans file names the API would refuse', () => {
    expect(uploadName('my/lesson\\one.mp4')).toBe('my_lesson_one.mp4');
    expect(uploadName('\u0000')).toBe('_');
    expect(uploadName('   ')).toBe('video');
    expect(uploadName('x'.repeat(300))).toHaveLength(200);
  });
});

describe('speed and time left', () => {
  it('smooths the speed and works out the time left', () => {
    let now = 0;
    const meter = createMeter(100 * MB, () => now);
    now = 1000;
    expect(meter(10 * MB)).toMatchObject({ loaded: 10 * MB, speed: 10 * MB, eta: 9 });
    now = 1100;
    // Too soon after the last sample: the speed holds.
    expect(meter(11 * MB).speed).toBe(10 * MB);
    now = 2000;
    const next = meter(30 * MB);
    expect(next.speed).toBeGreaterThan(10 * MB);
    expect(next.speed).toBeLessThan(20 * MB);
    expect(next.eta).toBeCloseTo((70 * MB) / next.speed);
  });
});
