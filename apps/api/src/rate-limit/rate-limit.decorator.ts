import { SetMetadata } from '@nestjs/common';

export interface RateLimitRule {
  /** Groups the counters, such as "login"; routes with the same name share them. */
  name: string;
  limit: number;
  windowMs: number;
  /** Count per signed-in person (falling back to the address) or always per address. */
  by?: 'user' | 'ip';
}

export const RATE_LIMITS = 'grand:rate-limits';

/** Replaces the default limit for a route or controller. Several rules may apply at once. */
export const RateLimit = (...rules: RateLimitRule[]) => SetMetadata(RATE_LIMITS, rules);

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;

/** Applies to every route without its own rule: generous, it only stops runaway clients. */
export const DEFAULT_RATE_LIMIT: RateLimitRule = { name: 'default', limit: 600, windowMs: MINUTE, by: 'user' };
