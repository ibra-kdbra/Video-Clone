import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { contentSecurityPolicy, securityHeaders, websocketOrigin } from '../config/headers.mjs';

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
