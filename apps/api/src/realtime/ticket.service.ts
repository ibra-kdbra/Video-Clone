import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { RealtimeTicket } from '@grand/contracts';
import { SessionsService } from '../auth/sessions.service.js';
import { randomToken, TOKEN_FORMAT } from '../common/crypto.js';
import type { AuthContext } from '../common/request-context.js';
import { RedisService } from '../redis/redis.service.js';

const TICKET_TTL_SECONDS = 30;
const ticketKey = (ticket: string) => `realtime:ticket:${createHash('sha256').update(ticket).digest('hex')}`;

/**
 * WebSocket sign-in. Browsers can't send an Authorization header when opening a WebSocket, and a
 * token in the URL ends up in logs, so the app first asks the API (with its access token) for a
 * ticket: random, valid for 30 seconds, and usable once (Redis GETDEL).
 */
@Injectable()
export class TicketService {
  constructor(
    private readonly redis: RedisService,
    private readonly sessions: SessionsService,
  ) {}

  async issue(auth: AuthContext): Promise<RealtimeTicket> {
    const ticket = randomToken();
    await this.redis.client.set(ticketKey(ticket), JSON.stringify(auth), 'EX', TICKET_TTL_SECONDS);
    return { ticket, expiresIn: TICKET_TTL_SECONDS };
  }

  async redeem(ticket: unknown): Promise<AuthContext | null> {
    if (typeof ticket !== 'string' || !TOKEN_FORMAT.test(ticket)) return null;
    const stored = await this.redis.client.getdel(ticketKey(ticket));
    if (!stored) return null;
    const auth = JSON.parse(stored) as AuthContext;
    return (await this.sessions.isRevoked(auth.sessionId)) ? null : auth;
  }
}
