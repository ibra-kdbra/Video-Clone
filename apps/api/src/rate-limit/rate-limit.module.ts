import { Global, Module } from '@nestjs/common';
import { RateLimiterService } from './rate-limiter.service.js';

@Global()
@Module({ providers: [RateLimiterService], exports: [RateLimiterService] })
export class RateLimitModule {}
