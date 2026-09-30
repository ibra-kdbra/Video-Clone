import { Injectable, Logger } from '@nestjs/common';
import type { DeviceSession } from '@grand/contracts';
import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import type { ClientInfo } from '../common/request-context.js';
import { hashToken, randomToken } from '../common/crypto.js';
import { AppConfig } from '../config/app-config.js';
import { DatabaseService, type Tx } from '../database/database.service.js';
import { refreshTokens, sessions } from '../database/schema.js';
import { AuditService } from '../events/audit.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { RedisService } from '../redis/redis.service.js';

export type RevokeReason = 'logout' | 'revoked' | 'reuse_detected';

export type RotateResult =
  | { status: 'rotated'; userId: string; sessionId: string; refreshToken: string }
  | { status: 'invalid' }
  | { status: 'reused'; userId: string; sessionId: string };

const revokedKey = (sessionId: string) => `auth:revoked:${sessionId}`;

/**
 * Signed-in devices. Each has a chain of single-use refresh tokens: using one issues the next, and
 * presenting one that was already used means it was copied, so the whole session is ended for
 * both the thief and the owner. Ending a session also blocks its access tokens at once (through
 * Redis, until they would have expired anyway) and disconnects its WebSockets.
 */
@Injectable()
export class SessionsService {
  private readonly logger = new Logger(SessionsService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly redis: RedisService,
    private readonly config: AppConfig,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
  ) {}

  async start(tx: Tx, userId: string, client: ClientInfo): Promise<{ sessionId: string; refreshToken: string }> {
    const [session] = await tx
      .insert(sessions)
      .values({
        userId,
        userAgent: client.userAgent,
        ip: client.ip,
        expiresAt: new Date(Date.now() + this.config.auth.sessionMaxMs),
      })
      .returning({ id: sessions.id, expiresAt: sessions.expiresAt });
    const refreshToken = await this.issueRefreshToken(tx, session!.id, session!.expiresAt);
    return { sessionId: session!.id, refreshToken };
  }

  async rotate(refreshToken: string, client: ClientInfo): Promise<RotateResult> {
    const tokenHash = hashToken(refreshToken);
    const result = await this.db.transaction({}, async (tx): Promise<RotateResult> => {
      // Claiming the token is one atomic update, so two requests racing with the same token can't
      // both succeed: the loser sees it as reused.
      const [claimed] = await tx
        .update(refreshTokens)
        .set({ usedAt: sql`now()` })
        .where(and(eq(refreshTokens.tokenHash, tokenHash), isNull(refreshTokens.usedAt)))
        .returning({ sessionId: refreshTokens.sessionId, expiresAt: refreshTokens.expiresAt });

      if (!claimed) {
        const [known] = await tx
          .select({ sessionId: refreshTokens.sessionId, userId: sessions.userId, revokedAt: sessions.revokedAt })
          .from(refreshTokens)
          .innerJoin(sessions, eq(sessions.id, refreshTokens.sessionId))
          .where(eq(refreshTokens.tokenHash, tokenHash));
        if (!known || known.revokedAt) return { status: 'invalid' };
        await this.markRevoked(tx, known.sessionId, 'reuse_detected');
        await this.audit.record(tx, {
          action: 'auth.refresh_token_reused',
          actorId: known.userId,
          targetType: 'session',
          targetId: known.sessionId,
          ip: client.ip,
        });
        return { status: 'reused', userId: known.userId, sessionId: known.sessionId };
      }

      if (claimed.expiresAt <= new Date()) return { status: 'invalid' };
      const [session] = await tx
        .update(sessions)
        .set({ lastUsedAt: sql`now()`, ip: client.ip, userAgent: client.userAgent })
        .where(and(eq(sessions.id, claimed.sessionId), isNull(sessions.revokedAt), gt(sessions.expiresAt, sql`now()`)))
        .returning({ id: sessions.id, userId: sessions.userId, expiresAt: sessions.expiresAt });
      if (!session) return { status: 'invalid' };

      const next = await this.issueRefreshToken(tx, session.id, session.expiresAt);
      return { status: 'rotated', userId: session.userId, sessionId: session.id, refreshToken: next };
    });

    if (result.status === 'reused') {
      this.logger.warn({ sessionId: result.sessionId }, 'Refresh token reused; session revoked');
      await this.afterRevoke(result.sessionId, 'reuse_detected');
    }
    return result;
  }

  /** Ends the session a refresh token belongs to (sign-out). Unknown tokens are ignored. */
  async endByRefreshToken(refreshToken: string, client: ClientInfo): Promise<void> {
    const ended = await this.db.transaction({}, async (tx) => {
      const [row] = await tx
        .select({ sessionId: refreshTokens.sessionId, userId: sessions.userId })
        .from(refreshTokens)
        .innerJoin(sessions, eq(sessions.id, refreshTokens.sessionId))
        .where(and(eq(refreshTokens.tokenHash, hashToken(refreshToken)), isNull(sessions.revokedAt)));
      if (!row) return null;
      await this.markRevoked(tx, row.sessionId, 'logout');
      await this.audit.record(tx, { action: 'auth.logout', actorId: row.userId, targetType: 'session', targetId: row.sessionId, ip: client.ip });
      return row.sessionId;
    });
    if (ended) await this.afterRevoke(ended, 'logout');
  }

  /** Ends one of the person's own sessions (signing out another device). */
  async end(userId: string, sessionId: string, client: ClientInfo): Promise<boolean> {
    const ended = await this.db.transaction({ userId }, async (tx) => {
      const [row] = await tx
        .update(sessions)
        .set({ revokedAt: sql`now()`, revokedReason: 'revoked' })
        .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId), isNull(sessions.revokedAt)))
        .returning({ id: sessions.id });
      if (!row) return false;
      await this.audit.record(tx, { action: 'auth.session_revoked', actorId: userId, targetType: 'session', targetId: sessionId, ip: client.ip });
      return true;
    });
    if (ended) await this.afterRevoke(sessionId, 'revoked');
    return ended;
  }

  async list(userId: string, currentSessionId: string): Promise<DeviceSession[]> {
    const rows = await this.db.transaction({ userId }, (tx) =>
      tx
        .select({ id: sessions.id, userAgent: sessions.userAgent, createdAt: sessions.createdAt, lastUsedAt: sessions.lastUsedAt })
        .from(sessions)
        .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt), gt(sessions.expiresAt, sql`now()`)))
        .orderBy(desc(sessions.lastUsedAt))
        .limit(50),
    );
    return rows.map((row) => ({
      id: row.id,
      userAgent: row.userAgent,
      createdAt: row.createdAt.toISOString(),
      lastUsedAt: row.lastUsedAt.toISOString(),
      current: row.id === currentSessionId,
    }));
  }

  /** Checked on every authenticated request: one Redis lookup, no database round trip. */
  async isRevoked(sessionId: string): Promise<boolean> {
    return (await this.redis.client.exists(revokedKey(sessionId))) === 1;
  }

  private async issueRefreshToken(tx: Tx, sessionId: string, sessionExpiresAt: Date): Promise<string> {
    const token = randomToken();
    const expiresAt = new Date(Math.min(Date.now() + this.config.auth.refreshTokenTtlMs, sessionExpiresAt.getTime()));
    await tx.insert(refreshTokens).values({ tokenHash: hashToken(token), sessionId, expiresAt });
    return token;
  }

  private async markRevoked(tx: Tx, sessionId: string, reason: RevokeReason) {
    await tx
      .update(sessions)
      .set({ revokedAt: sql`now()`, revokedReason: reason })
      .where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt)));
  }

  private async afterRevoke(sessionId: string, reason: RevokeReason) {
    // Access tokens live at most accessTokenTtl; blocking the session that long covers them all.
    await this.redis.client.set(revokedKey(sessionId), reason, 'EX', this.config.auth.accessTokenTtl + 60);
    this.realtime.endSession(sessionId, reason);
  }
}
