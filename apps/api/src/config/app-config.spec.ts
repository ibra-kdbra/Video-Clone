import { describe, expect, it } from 'vitest';
import { loadConfig } from './app-config.js';

const base = {
  DATABASE_URL: 'postgres://grand_app:secret@localhost:5432/grand',
  REDIS_URL: 'redis://localhost:6379',
  JWT_SECRET: 'x'.repeat(43),
};

describe('configuration', () => {
  it('fills in safe defaults', () => {
    const config = loadConfig(base);
    expect(config.port).toBe(3000);
    expect(config.auth.accessTokenTtl).toBe(900);
    expect(config.auth.cookieSecure).toBe(false);
    expect(config.webOrigins).toEqual(['http://localhost:5173']);
    expect(config.openApi).toBe(true);
  });

  it('turns on production hardening in production', () => {
    const config = loadConfig({ ...base, NODE_ENV: 'production', WEB_ORIGINS: 'https://grand.example/, https://www.grand.example' });
    expect(config.auth.cookieSecure).toBe(true);
    expect(config.openApi).toBe(false);
    expect(config.webOrigins).toEqual(['https://grand.example', 'https://www.grand.example']);
  });

  it('reads the proxy setting as a flag, a hop count or a list of addresses', () => {
    expect(loadConfig({ ...base, TRUST_PROXY: 'true' }).trustProxy).toBe(true);
    expect(loadConfig({ ...base, TRUST_PROXY: '2' }).trustProxy).toBe(2);
    expect(loadConfig({ ...base, TRUST_PROXY: '127.0.0.1, 10.0.0.0/8' }).trustProxy).toEqual(['127.0.0.1', '10.0.0.0/8']);
  });

  it('sets up LiveKit only when it is configured, treating empty values as unset', () => {
    expect(loadConfig(base).livekit).toBeNull();
    expect(loadConfig({ ...base, LIVEKIT_URL: '', LIVEKIT_API_KEY: '', LIVEKIT_API_SECRET: '' }).livekit).toBeNull();
    expect(loadConfig({ ...base, LIVEKIT_URL: 'wss://live.grand.example/', LIVEKIT_API_KEY: 'key', LIVEKIT_API_SECRET: 'secret' }).livekit).toEqual({
      url: 'wss://live.grand.example',
      apiUrl: 'https://live.grand.example',
      apiKey: 'key',
      apiSecret: 'secret',
    });
    expect(loadConfig({ ...base, LIVEKIT_URL: 'wss://live.grand.example', LIVEKIT_API_URL: 'http://livekit:7880', LIVEKIT_API_KEY: 'key', LIVEKIT_API_SECRET: 'secret' }).livekit?.apiUrl).toBe('http://livekit:7880');
    expect(() => loadConfig({ ...base, LIVEKIT_URL: 'wss://live.grand.example' })).toThrow(/LIVEKIT_URL needs/);
    expect(() => loadConfig({ ...base, LIVEKIT_URL: 'https://live.grand.example', LIVEKIT_API_KEY: 'key', LIVEKIT_API_SECRET: 'secret' })).toThrow(/LIVEKIT_URL/);
  });

  it('lists every problem at once', () => {
    expect(() => loadConfig({ DATABASE_URL: 'mysql://x', JWT_SECRET: 'short' })).toThrow(
      /DATABASE_URL[\s\S]*REDIS_URL[\s\S]*JWT_SECRET/,
    );
  });
});
