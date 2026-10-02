import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { contentSecurityPolicy, livekitOrigins, mediaOrigin, securityHeaders, websocketOrigin } from '../config/headers.mjs';

const root = path.resolve(import.meta.dirname, '..');
const read = (file) => readFileSync(path.join(root, file), 'utf8');
const csp = contentSecurityPolicy();
const directive = (name) => csp.split(';').map((d) => d.trim()).find((d) => d.startsWith(`${name} `)) ?? '';

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? files(full) : [full];
  });
}

describe('Content-Security-Policy', () => {
  it("allows index.html's inline theme script by its exact hash (update config/headers.mjs when it changes)", () => {
    const script = read('index.html').match(/<script>(.*?)<\/script>/s)[1];
    const hash = createHash('sha256').update(script).digest('base64');
    expect(directive('script-src')).toContain(`'sha256-${hash}'`);
  });

  it('never allows inline or evaluated code', () => {
    expect(csp).not.toMatch(/unsafe-inline|unsafe-eval|unsafe-hashes/);
    expect(directive('script-src')).toMatch(/^script-src 'self' 'sha256-[A-Za-z0-9+/=]+'$/);
  });

  it('locks down framing, plugins, base URLs, forms and API calls', () => {
    expect(directive('frame-ancestors')).toBe("frame-ancestors 'none'");
    expect(directive('object-src')).toBe("object-src 'none'");
    expect(directive('base-uri')).toBe("base-uri 'none'");
    expect(directive('form-action')).toBe("form-action 'self'");
    expect(directive('connect-src')).toBe("connect-src 'self'");
    expect(directive('require-trusted-types-for')).toBe("require-trusted-types-for 'script'");
  });

  it('frames only the platforms’ players, over https', () => {
    expect(directive('frame-src').split(' ').slice(1).every((source) => source.startsWith('https://'))).toBe(true);
  });

  it('adds only the real-time server’s secure WebSocket origin to connect-src', () => {
    const policy = contentSecurityPolicy({ realtimeOrigin: 'https://grand-lms.duckdns.org' });
    expect(policy).toContain("connect-src 'self' wss://grand-lms.duckdns.org;");
    expect(websocketOrigin('http://localhost:3000')).toBe('ws://localhost:3000');
    expect(() => websocketOrigin('http://grand-lms.duckdns.org')).toThrow(/https/);
    expect(() => websocketOrigin('https://grand-lms.duckdns.org/path')).toThrow(/bare origin/);
  });

  it('lets videos and posters come from the video store only, and the player use blob: streams', () => {
    const policy = contentSecurityPolicy({ mediaOrigin: 'https://media.grand-lms.duckdns.org' });
    const get = (name) => policy.split(';').map((d) => d.trim()).find((d) => d.startsWith(`${name} `));
    expect(get('media-src')).toBe("media-src 'self' blob: https://media.grand-lms.duckdns.org");
    expect(get('connect-src')).toBe("connect-src 'self' https://media.grand-lms.duckdns.org");
    expect(get('img-src')).toContain('https://media.grand-lms.duckdns.org');
    expect(get('worker-src')).toBe("worker-src 'none'");
    expect(directive('media-src')).toBe("media-src 'self' blob:");
    expect(() => mediaOrigin('http://media.example.com')).toThrow(/https/);
    expect(mediaOrigin('http://localhost:3900')).toBe('http://localhost:3900');
  });

  it('lets live classes reach the LiveKit server, over wss:// and its https:// twin, only when there is one', () => {
    const policy = contentSecurityPolicy({ livekitOrigin: 'wss://live.grand-lms.duckdns.org' });
    const get = (name) => policy.split(';').map((d) => d.trim()).find((d) => d.startsWith(`${name} `));
    expect(get('connect-src')).toBe("connect-src 'self' wss://live.grand-lms.duckdns.org https://live.grand-lms.duckdns.org");
    // Nothing else opens up for it: WebRTC media isn't governed by the CSP, and nothing is framed or run from there.
    expect(get('frame-src')).toBe(directive('frame-src'));
    expect(get('script-src')).toBe(directive('script-src'));
    expect(get('media-src')).toBe(directive('media-src'));
    expect(directive('connect-src')).toBe("connect-src 'self'");
    expect(livekitOrigins(undefined)).toBeNull();
    expect(livekitOrigins('ws://127.0.0.1:7880')).toEqual(['ws://127.0.0.1:7880', 'http://127.0.0.1:7880']);
    expect(livekitOrigins('wss://live.example.com/')).toEqual(['wss://live.example.com', 'https://live.example.com']);
    const all = contentSecurityPolicy({ realtimeOrigin: 'https://api.example.com', livekitOrigin: 'wss://live.example.com', mediaOrigin: 'https://media.example.com' });
    expect(all).toContain("connect-src 'self' wss://api.example.com wss://live.example.com https://live.example.com https://media.example.com;");
  });

  it('refuses a LiveKit origin that isn’t a bare wss:// origin', () => {
    expect(() => livekitOrigins('wss://live.example.com/rtc')).toThrow(/bare origin/);
    expect(() => livekitOrigins('wss://user:pass@live.example.com')).toThrow(/bare origin/);
    expect(() => livekitOrigins('https://live.example.com')).toThrow(/wss/);
    expect(() => livekitOrigins('ws://live.example.com')).toThrow(/wss/);
    expect(() => livekitOrigins('live.example.com')).toThrow();
    expect(() => contentSecurityPolicy({ livekitOrigin: 'wss://live.example.com/x' })).toThrow(/bare origin/);
  });

  it('lets this site alone use the camera, microphone and screen sharing (live classes), and nothing else', () => {
    const policy = securityHeaders()['Permissions-Policy'];
    expect(policy).toContain('camera=(self)');
    expect(policy).toContain('microphone=(self)');
    expect(policy).toContain('display-capture=(self)');
    expect(policy).toContain('geolocation=()');
    expect(policy).toContain('payment=()');
  });

  it('forces HTTPS in production and drops only that for local previews', () => {
    expect(securityHeaders()['Strict-Transport-Security']).toMatch(/max-age=31536000/);
    expect(csp).toMatch(/upgrade-insecure-requests$/);
    const local = securityHeaders({ https: false });
    expect(local['Strict-Transport-Security']).toBeUndefined();
    expect(local['Content-Security-Policy']).not.toContain('upgrade-insecure-requests');
    expect(local['X-Frame-Options']).toBe('DENY');
  });
});

describe('the browser code', () => {
  const source = files(path.join(root, 'src')).filter((file) => /\.(jsx?|scss)$/.test(file));

  it('contains no API keys, key variables or direct calls to the video APIs', () => {
    for (const file of source) {
      const text = readFileSync(file, 'utf8');
      expect(text, file).not.toMatch(/VITE_[A-Z_]*KEY|AIza[0-9A-Za-z_-]{20,}|googleapis\.com|api\.twitch\.tv|api\.dailymotion\.com|rapidapi/i);
    }
  });

  it('never renders raw HTML', () => {
    for (const file of source) expect(readFileSync(file, 'utf8'), file).not.toMatch(/dangerouslySetInnerHTML|innerHTML\s*=/);
  });

  it('opens every new-tab link without giving the page access to Grand LMS', () => {
    for (const file of source) {
      const text = readFileSync(file, 'utf8');
      const blanks = text.match(/target="_blank"[^>]*>/g) ?? [];
      for (const tag of blanks) expect(tag, file).toMatch(/rel="noopener noreferrer/);
    }
  });
});
