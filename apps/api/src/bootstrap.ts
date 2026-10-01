import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { isIP } from 'node:net';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { AllExceptionsFilter } from './common/all-exceptions.filter.js';
import { validationPipe } from './common/validation.js';
import type { AppConfig } from './config/app-config.js';
import { RealtimeIoAdapter } from './realtime/realtime-io.adapter.js';

const REQUEST_ID = /^[A-Za-z0-9._-]{8,64}$/;
const trustNearest = (hops: number) => (_address: string, hop: number) => hop < hops;

/** Builds the configured application without listening, so tests can start it on any port. */
export async function createApp(config: AppConfig): Promise<NestFastifyApplication> {
  const adapter = new FastifyAdapter({
    // A hop count becomes "trust the nearest n proxies", as proxy-addr counts them.
    trustProxy: typeof config.trustProxy === 'number' ? trustNearest(config.trustProxy) : config.trustProxy,
    // The API takes small JSON bodies only; uploads will go straight to storage.
    bodyLimit: 100 * 1024,
    return503OnClosing: true,
    // Keeps a well-formed X-Request-Id from a proxy in front, or makes one; logs and errors carry it.
    requestIdHeader: false,
    genReqId: (request: IncomingMessage) => {
      const incoming = request.headers['x-request-id'];
      return typeof incoming === 'string' && REQUEST_ID.test(incoming) ? incoming : randomUUID();
    },
    routerOptions: { maxParamLength: 200 },
  });
  const app = await NestFactory.create<NestFastifyApplication>(AppModule.forRoot(config), adapter, {
    bufferLogs: true,
    abortOnError: false,
  });
  app.useLogger(app.get(Logger));

  const fastify = app.getHttpAdapter().getInstance();
  // JSON only: a text/plain body is what a cross-site form can send without a preflight.
  fastify.removeContentTypeParser('text/plain');
  fastify.decorateRequest('clientIp', '');
  fastify.addHook('onRequest', async (request, reply) => {
    reply.header('x-request-id', request.id);
    const forwarded = config.clientIpHeader ? request.headers[config.clientIpHeader] : undefined;
    request.clientIp = typeof forwarded === 'string' && isIP(forwarded.trim()) ? forwarded.trim() : request.ip;
  });
  // API answers are personal: nothing is cached unless a route says otherwise.
  fastify.addHook('onSend', async (_request, reply) => {
    if (!reply.hasHeader('cache-control')) reply.header('cache-control', 'no-store');
  });

  // The API serves JSON only, so its pages may load nothing and be framed by no one.
  await app.register(helmet, {
    contentSecurityPolicy: {
      useDefaults: false,
      directives: { defaultSrc: ["'none'"], baseUri: ["'none'"], formAction: ["'none'"], frameAncestors: ["'none'"] },
    },
    frameguard: { action: 'deny' },
    hsts: config.production ? { maxAge: 31_536_000, includeSubDomains: true } : false,
    crossOriginResourcePolicy: { policy: 'same-site' },
  });
  await app.register(cookie);
  app.enableCors({
    origin: config.webOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
    allowedHeaders: ['authorization', 'content-type', 'x-request-id'],
    exposedHeaders: ['x-request-id', 'retry-after', 'ratelimit-limit', 'ratelimit-remaining', 'ratelimit-reset'],
    maxAge: 600,
  });

  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(validationPipe);
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useWebSocketAdapter(new RealtimeIoAdapter(app));
  app.enableShutdownHooks();

  if (config.openApi) {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('Grand LMS API')
        .setDescription('Schools, people and real-time events for Grand LMS. Every error has the shape { error: { code, message } }.')
        .setVersion('1')
        .addBearerAuth()
        .addCookieAuth('grand_rt')
        .build(),
    );
    SwaggerModule.setup('api/v1/docs', app, document, { ui: false, raw: ['json'], jsonDocumentUrl: 'api/v1/openapi.json' });
  }
  return app;
}
