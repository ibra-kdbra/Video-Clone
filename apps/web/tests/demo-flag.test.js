import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Demo mode (VITE_DEMO) only ever switches the app over to the mock API: with it off, no demo
 * code is loaded (and none is imported in a way the build couldn't drop); with it on, every API
 * call goes to the mock, never the network.
 */

const loaded = { server: 0, socket: 0, xhr: 0 };
vi.mock('../src/demo/server.js', () => {
  loaded.server += 1;
  return {
    demoFetch: vi.fn(async () => new Response(JSON.stringify({ user: { id: 'u1' }, schools: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } })),
  };
});
vi.mock('../src/demo/socket.js', () => {
  loaded.socket += 1;
  return { connect: () => ({ socket: {}, close() {} }) };
});
vi.mock('../src/demo/xhr.js', () => {
  loaded.xhr += 1;
  return { createDemoRequest: () => ({}) };
});
vi.mock('../src/lib/realtime.js', () => ({ connect: () => ({ socket: { on() {} }, close() {} }) }));

const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

async function fresh(flag) {
  vi.resetModules();
  vi.stubEnv('VITE_DEMO', flag);
  const store = new Map();
  vi.stubGlobal('localStorage', { getItem: (key) => store.get(key) ?? null, setItem: (key, value) => store.set(key, String(value)), removeItem: (key) => store.delete(key) });
  vi.stubGlobal('window', { addEventListener: vi.fn(), requestIdleCallback: (fn) => fn() });
  vi.stubGlobal('navigator', {});
  const fetch = vi.fn(async () => json({ ok: true }));
  vi.stubGlobal('fetch', fetch);
  return { fetch };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  loaded.server = 0;
  loaded.socket = 0;
  loaded.xhr = 0;
});

describe('with the demo off', () => {
  it('calls the real API, and loads no demo code', async () => {
    const { fetch } = await fresh('false');
    const demo = await import('../src/lib/demo.js');
    expect(demo.DEMO).toBe(false);
    expect(demo.loadDemo).toBeNull();
    const session = await import('../src/lib/session.js');
    await session.apiFetch('/schools/riverside/public', { auth: false });
    expect(fetch).toHaveBeenCalledWith('/api/v1/schools/riverside/public', expect.any(Object));

    // The live connection is the real one…
    const live = await import('../src/lib/live.js');
    live.startLive();
    await new Promise((resolve) => setTimeout(resolve, 10));
    live.stopLive();
    // …and handed-in files go over XMLHttpRequest.
    const requests = [];
    vi.stubGlobal(
      'XMLHttpRequest',
      class {
        constructor() {
          requests.push(this);
          this.upload = {};
        }
        open() {}
        setRequestHeader() {}
        send() {
          this.status = 200;
          this.onload();
        }
      },
    );
    const { uploadSubmissionFile } = await import('../src/lib/assignments.js');
    const api = { start: async () => ({ file: { id: 'f1' }, url: 'https://store/f1', contentType: 'text/plain' }), complete: async () => ({ ok: true }), remove: async () => {} };
    await uploadSubmissionFile(new Blob(['hi'], { type: 'text/plain' }), { api });
    expect(requests).toHaveLength(1);
    expect(loaded).toEqual({ server: 0, socket: 0, xhr: 0 });
  });

  it('imports src/demo only dynamically, behind the flag, so the build can drop it', () => {
    const root = path.resolve(import.meta.dirname, '../src');
    const files = (dir) => readdirSync(dir).flatMap((name) => (statSync(path.join(dir, name)).isDirectory() ? files(path.join(dir, name)) : [path.join(dir, name)]));
    const outside = files(root).filter((file) => /\.(jsx?)$/.test(file) && !file.includes(`${path.sep}demo${path.sep}`));
    const uses = [];
    for (const file of outside) {
      const lines = readFileSync(file, 'utf8').split('\n');
      for (const [i, line] of lines.entries()) {
        if (!/['"](\.\.?\/)+demo\//.test(line)) continue;
        uses.push(path.relative(root, file));
        // A dynamic import, guarded by the flag on its line or just before it.
        expect(line, `${file}: ${line}`).toMatch(/import\(/);
        expect(line, `${file}: ${line}`).not.toMatch(/^\s*import\s/);
        expect(lines.slice(Math.max(0, i - 2), i + 1).join('\n'), `${file}: ${line}`).toMatch(/DEMO/);
      }
    }
    // The places that switch over: the API client, live updates, files, downloads, the pages.
    expect(uses).toEqual(expect.arrayContaining([path.join('lib', 'demo.js'), path.join('lib', 'live.js'), path.join('lib', 'assignments.js'), path.join('lib', 'learning.js')]));
  });
});

describe('with the demo on', () => {
  it('sends every API call to the mock in the page, never the network', async () => {
    const { fetch } = await fresh('true');
    const demo = await import('../src/lib/demo.js');
    expect(demo.DEMO).toBe(true);
    const session = await import('../src/lib/session.js');
    const me = await session.apiFetch('/schools/riverside/public', { auth: false });
    expect(me).toMatchObject({ schools: [] });
    expect(fetch).not.toHaveBeenCalled();
    const server = await import('../src/demo/server.js');
    expect(server.demoFetch).toHaveBeenCalledWith('/api/v1/schools/riverside/public', expect.objectContaining({ method: 'GET' }));
    expect(demo.loadedDemo()).toBe(server);
  });
});
