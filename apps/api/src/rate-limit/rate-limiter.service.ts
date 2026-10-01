import { Injectable } from '@nestjs/common';
import { RedisService } from '../redis/redis.service.js';

/**
 * Sliding-window counter, atomic in Redis: the previous window's count is weighted by how much of
 * it still overlaps the sliding window, which smooths out the burst a fixed window allows at its
 * edge. Redis's own clock is used, so every API instance agrees on the windows. With cost 0 it only
 * reports, which lets callers check a limit without spending from it.
 *
 * KEYS[1] base key; ARGV: limit, window (ms), cost. Returns {allowed, count, ms until the window ends}.
 */
const SCRIPT = `
local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
local limit = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local cost = tonumber(ARGV[3])
local index = math.floor(now / window)
local current_key = KEYS[1] .. ':' .. index
local previous_key = KEYS[1] .. ':' .. (index - 1)
local elapsed = now - index * window
local previous = tonumber(redis.call('GET', previous_key) or '0')
local current = tonumber(redis.call('GET', current_key) or '0')
local weighted = previous * (window - elapsed) / window
local count = math.ceil(weighted + current)
if cost > 0 then
  if weighted + current + cost > limit then
    return {0, count, window - elapsed}
  end
  current = redis.call('INCRBY', current_key, cost)
  redis.call('PEXPIRE', current_key, window * 2)
  count = math.ceil(weighted + current)
end
return {1, count, window - elapsed}
`;

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Seconds until the current window ends. */
  resetIn: number;
}

@Injectable()
export class RateLimiterService {
  constructor(private readonly redis: RedisService) {}

  async consume(key: string, limit: number, windowMs: number, cost = 1): Promise<RateLimitResult> {
    // The hash tag keeps both windows of a key in one slot, should Redis ever be clustered.
    const [allowed, count, resetMs] = (await this.redis.client.eval(SCRIPT, 1, `rl:{${key}}`, limit, windowMs, cost)) as [
      number,
      number,
      number,
    ];
    return {
      allowed: allowed === 1 && (cost > 0 || count < limit),
      limit,
      remaining: Math.max(0, limit - count),
      resetIn: Math.max(1, Math.ceil(resetMs / 1000)),
    };
  }

  peek(key: string, limit: number, windowMs: number) {
    return this.consume(key, limit, windowMs, 0);
  }
}
