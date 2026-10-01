import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { AuthSession, ClientToServerEvents, ServerToClientEvents } from '@grand/contracts';
import { io, type Socket } from 'socket.io-client';
import { inject } from 'vitest';
import { createApp } from '../src/bootstrap.js';
import { loadConfig } from '../src/config/app-config.js';

export const WEB_ORIGIN = 'http://localhost:5173';
export const PASSWORD = 'correct horse battery staple';

export interface TestResponse<T = any> {
  status: number;
  body: T;
  headers: Headers;
}

/** A running API on a random port, plus a small client for it. */
export class TestApi {
  private constructor(
    readonly app: NestFastifyApplication,
    readonly url: string,
  ) {}

  static async start(env: Record<string, string> = {}): Promise<TestApi> {
    const s3 = inject('s3');
    const config = loadConfig({
      ...(s3 && {
        S3_ENDPOINT: s3.endpoint,
        S3_BUCKET: s3.bucket,
        S3_ACCESS_KEY_ID: s3.accessKeyId,
        S3_SECRET_ACCESS_KEY: s3.secretAccessKey,
        S3_REGION: s3.region,
      }),
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      DATABASE_URL: inject('appDatabaseUrl'),
      DATABASE_POOL_SIZE: '5',
      REDIS_URL: inject('redisUrl'),
      JWT_SECRET: 'test-secret-that-is-long-enough-for-hs256-signing-000',
      WEB_ORIGINS: WEB_ORIGIN,
      PUBLIC_WEB_URL: WEB_ORIGIN,
      RATE_LIMITS: 'false',
      OPENAPI: 'true',
      ...env,
    });
    const app = await createApp(config);
    await app.listen({ port: 0, host: '127.0.0.1' });
    const address = app.getHttpServer().address();
    if (!address || typeof address === 'string') throw new Error('No address');
    return new TestApi(app, `http://127.0.0.1:${address.port}`);
  }

  async request<T = any>(
    method: string,
    path: string,
    options: { token?: string; body?: unknown; cookie?: string; headers?: Record<string, string> } = {},
  ): Promise<TestResponse<T>> {
    const headers: Record<string, string> = { ...options.headers };
    if (options.token) headers.authorization = `Bearer ${options.token}`;
    if (options.cookie) headers.cookie = options.cookie;
    if (options.body !== undefined) headers['content-type'] ??= 'application/json';
    const response = await fetch(`${this.url}/api/v1${path}`, {
      method,
      headers,
      body: options.body === undefined ? undefined : typeof options.body === 'string' ? options.body : JSON.stringify(options.body),
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null, headers: response.headers };
  }

  /** Signs up a new person with a unique address; returns their token and refresh cookie. */
  async signup(name = 'Test Person', email = uniqueEmail()) {
    const response = await this.request<AuthSession>('POST', '/auth/signup', { body: { email, password: PASSWORD, name } });
    if (response.status !== 201) throw new Error(`signup failed: ${JSON.stringify(response.body)}`);
    return { ...response.body, token: response.body.accessToken, email, cookie: refreshCookie(response.headers) };
  }

  async createSchool(token: string, slug = uniqueSlug(), name = 'Test School') {
    const response = await this.request('POST', '/schools', { token, body: { name, slug } });
    if (response.status !== 201) throw new Error(`create school failed: ${JSON.stringify(response.body)}`);
    return response.body as { id: string; slug: string; name: string };
  }

  /** Opens an authenticated WebSocket (ticket first, like the web app). */
  async socket(token: string, origin = WEB_ORIGIN): Promise<Socket<ServerToClientEvents, ClientToServerEvents>> {
    const { body } = await this.request('POST', '/realtime/ticket', { token });
    return this.rawSocket(body.ticket, origin);
  }

  rawSocket(ticket: string, origin = WEB_ORIGIN): Socket<ServerToClientEvents, ClientToServerEvents> {
    return io(this.url, {
      path: '/api/v1/ws',
      transports: ['websocket'],
      auth: { ticket },
      extraHeaders: { origin },
      reconnection: false,
      forceNew: true,
    });
  }

  close() {
    return this.app.close();
  }
}

export const uniqueEmail = () => `person-${randomBytes(6).toString('hex')}@example.com`;
export const uniqueSlug = () => `school-${randomBytes(5).toString('hex')}`;

/** The refresh cookie from a response, ready to send back ("name=value"). */
export function refreshCookie(headers: Headers): string {
  const cookie = headers.getSetCookie().find((value) => value.startsWith('grand_rt='));
  return cookie ? cookie.split(';')[0]! : '';
}

export const connected = (socket: Socket) =>
  new Promise<void>((resolve, reject) => {
    socket.once('connect', () => resolve());
    socket.once('connect_error', reject);
  });

export const nextEvent = <T>(socket: Socket<any, any>, event: string, timeoutMs = 3000) =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`No ${event} within ${timeoutMs} ms`)), timeoutMs);
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
