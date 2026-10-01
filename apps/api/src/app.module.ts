import { type DynamicModule, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { AuthGuard } from './auth/auth.guard.js';
import { AuthModule } from './auth/auth.module.js';
import { CoursesModule } from './courses/courses.module.js';
import { LearningModule } from './learning/learning.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import type { AppConfig } from './config/app-config.js';
import { ConfigModule } from './config/config.module.js';
import { DatabaseModule } from './database/database.module.js';
import { EventsModule } from './events/events.module.js';
import { HealthModule } from './health/health.module.js';
import { RateLimitGuard } from './rate-limit/rate-limit.guard.js';
import { RateLimitModule } from './rate-limit/rate-limit.module.js';
import { RealtimeCoreModule } from './realtime/realtime-core.module.js';
import { RealtimeModule } from './realtime/realtime.module.js';
import { RedisModule } from './redis/redis.module.js';
import { SchoolsModule } from './schools/schools.module.js';
import { StorageModule } from './storage/storage.module.js';

@Module({})
export class AppModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ConfigModule.forRoot(config),
        LoggerModule.forRoot({
          pinoHttp: {
            level: config.logLevel,
            // Fastify assigns the request id (see bootstrap.ts); pino-http picks it up from req.id.
            serializers: {
              req: (request: { id: string; method: string; url: string; remoteAddress?: string }) => ({
                id: request.id,
                method: request.method,
                url: request.url,
                remoteAddress: request.remoteAddress,
              }),
              res: (response: { statusCode: number }) => ({ statusCode: response.statusCode }),
            },
            redact: {
              paths: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
              censor: '[redacted]',
            },
            autoLogging: { ignore: (request) => request.url?.startsWith('/api/v1/health') ?? false },
            customLogLevel: (_request, response, error) =>
              error || response.statusCode >= 500 ? 'error' : response.statusCode >= 400 ? 'warn' : 'info',
            ...(config.env !== 'development' ? {} : { transport: { target: 'pino-pretty', options: { singleLine: true, ignore: 'pid,hostname' } } }),
          },
        }),
        DatabaseModule,
        RedisModule,
        RateLimitModule,
        EventsModule,
        RealtimeCoreModule,
        StorageModule,
        AuthModule,
        SchoolsModule,
        CoursesModule,
        LearningModule,
        NotificationsModule,
        RealtimeModule,
        HealthModule,
      ],
      providers: [
        // Order matters: who is asking first, then how often they may ask.
        { provide: APP_GUARD, useExisting: AuthGuard },
        { provide: APP_GUARD, useClass: RateLimitGuard },
      ],
    };
  }
}
