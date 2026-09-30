import { type CanActivate, type ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ApiException } from '../common/api-exception.js';
import { AppConfig } from '../config/app-config.js';
import { DEFAULT_RATE_LIMIT, RATE_LIMITS, type RateLimitRule } from './rate-limit.decorator.js';
import { RateLimiterService } from './rate-limiter.service.js';

/**
 * Applies the route's rate limits (or the default one) and reports the tightest in the standard
 * RateLimit-* headers. Runs after authentication, so signed-in people are counted by account
 * rather than by a possibly shared address.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly limiter: RateLimiterService,
    private readonly config: AppConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!this.config.rateLimits || context.getType() !== 'http') return true;
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const reply = context.switchToHttp().getResponse<FastifyReply>();
    const rules =
      this.reflector.getAllAndOverride<RateLimitRule[]>(RATE_LIMITS, [context.getHandler(), context.getClass()]) ?? [DEFAULT_RATE_LIMIT];

    let tightest: Awaited<ReturnType<RateLimiterService['consume']>> | null = null;
    for (const rule of rules) {
      const subject = rule.by !== 'ip' && request.auth ? `u:${request.auth.userId}` : `ip:${request.clientIp}`;
      const result = await this.limiter.consume(`${rule.name}:${subject}`, rule.limit, rule.windowMs);
      if (!tightest || result.remaining < tightest.remaining) tightest = result;
      if (!result.allowed) {
        throw new ApiException(HttpStatus.TOO_MANY_REQUESTS, 'rate_limited', 'Too many requests. Please wait a moment and try again.', undefined, {
          'retry-after': String(result.resetIn),
          'ratelimit-limit': String(result.limit),
          'ratelimit-remaining': '0',
          'ratelimit-reset': String(result.resetIn),
        });
      }
    }
    if (tightest) {
      reply.header('ratelimit-limit', String(tightest.limit));
      reply.header('ratelimit-remaining', String(tightest.remaining));
      reply.header('ratelimit-reset', String(tightest.resetIn));
    }
    return true;
  }
}
