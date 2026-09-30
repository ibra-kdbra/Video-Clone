import { HttpStatus, Injectable } from '@nestjs/common';
import type { LoginInput, Me, SignupInput, User } from '@grand/contracts';
import { eq } from 'drizzle-orm';
import { ApiException } from '../common/api-exception.js';
import type { ClientInfo } from '../common/request-context.js';
import { DatabaseService } from '../database/database.service.js';
import { isUniqueViolation } from '../database/errors.js';
import { users } from '../database/schema.js';
import { AuditService } from '../events/audit.service.js';
import { RedisService } from '../redis/redis.service.js';
import { SchoolsService } from '../schools/schools.service.js';
import { PasswordService } from './password.service.js';
import { SessionsService } from './sessions.service.js';
import { TokenService } from './token.service.js';

/** Failed logins allowed per address before it's locked for the rest of the window. */
const MAX_FAILED_LOGINS = 10;
const FAILED_LOGIN_WINDOW_SECONDS = 15 * 60;
const failedLoginsKey = (email: string) => `auth:failed:${email}`;

export interface IssuedSession {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  user: User;
}

type UserRow = typeof users.$inferSelect;

export function toUser(row: Pick<UserRow, 'id' | 'email' | 'name' | 'emailVerifiedAt' | 'createdAt'>): User {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    emailVerified: row.emailVerifiedAt !== null,
    createdAt: row.createdAt.toISOString(),
  };
}

const invalidCredentials = () =>
  new ApiException(HttpStatus.UNAUTHORIZED, 'invalid_credentials', "That email and password don't match an account.");

@Injectable()
export class AuthService {
  constructor(
    private readonly db: DatabaseService,
    private readonly redis: RedisService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly sessions: SessionsService,
    private readonly audit: AuditService,
    private readonly schools: SchoolsService,
  ) {}

  async signup(input: SignupInput, client: ClientInfo): Promise<IssuedSession> {
    const passwordHash = await this.passwords.hash(input.password);
    try {
      const { user, session } = await this.db.transaction({}, async (tx) => {
        const [user] = await tx.insert(users).values({ email: input.email, name: input.name, passwordHash }).returning();
        const session = await this.sessions.start(tx, user!.id, client);
        await this.audit.record(tx, { action: 'auth.signup', actorId: user!.id, targetType: 'user', targetId: user!.id, ip: client.ip });
        return { user: user!, session };
      });
      return this.issue(user, session);
    } catch (error) {
      if (isUniqueViolation(error, 'users_email_key')) {
        throw new ApiException(HttpStatus.CONFLICT, 'email_taken', 'An account with this email already exists. Sign in instead.');
      }
      throw error;
    }
  }

  async login(input: LoginInput, client: ClientInfo): Promise<IssuedSession> {
    const failuresKey = failedLoginsKey(input.email);
    const failures = Number(await this.redis.client.get(failuresKey));
    if (failures >= MAX_FAILED_LOGINS) {
      const retryAfter = Math.max(1, await this.redis.client.ttl(failuresKey));
      throw new ApiException(HttpStatus.TOO_MANY_REQUESTS, 'rate_limited', 'Too many attempts for this account. Try again later.', undefined, {
        'retry-after': String(retryAfter),
      });
    }

    const [user] = await this.db.transaction({}, (tx) => tx.select().from(users).where(eq(users.email, input.email)));
    // Unknown addresses are checked against a dummy hash, so they take as long as wrong passwords.
    const valid = await this.passwords.verify(user?.passwordHash ?? null, input.password);
    if (!user || !valid) {
      await this.redis.client.multi().incr(failuresKey).expire(failuresKey, FAILED_LOGIN_WINDOW_SECONDS, 'NX').exec();
      if (user) {
        await this.db.transaction({ userId: user.id }, (tx) =>
          this.audit.record(tx, { action: 'auth.login_failed', actorId: user.id, targetType: 'user', targetId: user.id, ip: client.ip }),
        );
      }
      throw invalidCredentials();
    }

    await this.redis.client.del(failuresKey);
    const upgradedHash = this.passwords.needsRehash(user.passwordHash) ? await this.passwords.hash(input.password) : null;
    const session = await this.db.transaction({ userId: user.id }, async (tx) => {
      if (upgradedHash) await tx.update(users).set({ passwordHash: upgradedHash }).where(eq(users.id, user.id));
      await this.audit.record(tx, { action: 'auth.login', actorId: user.id, targetType: 'user', targetId: user.id, ip: client.ip });
      return this.sessions.start(tx, user.id, client);
    });
    return this.issue(user, session);
  }

  async refresh(refreshToken: string, client: ClientInfo): Promise<IssuedSession> {
    const result = await this.sessions.rotate(refreshToken, client);
    if (result.status !== 'rotated') {
      throw new ApiException(HttpStatus.UNAUTHORIZED, 'session_expired', 'Your session has ended. Please sign in again.');
    }
    const [user] = await this.db.transaction({ userId: result.userId }, (tx) =>
      tx.select().from(users).where(eq(users.id, result.userId)),
    );
    if (!user) throw new ApiException(HttpStatus.UNAUTHORIZED, 'session_expired', 'Your session has ended. Please sign in again.');
    return this.issue(user, result);
  }

  async me(userId: string): Promise<Me> {
    const [user] = await this.db.transaction({ userId }, (tx) => tx.select().from(users).where(eq(users.id, userId)));
    if (!user) throw new ApiException(HttpStatus.UNAUTHORIZED, 'unauthenticated', 'Sign in to continue.');
    return { user: toUser(user), schools: await this.schools.mine(userId) };
  }

  private async issue(user: UserRow, session: { sessionId: string; refreshToken: string }): Promise<IssuedSession> {
    return {
      accessToken: await this.tokens.sign({ userId: user.id, sessionId: session.sessionId }),
      expiresIn: this.tokens.accessTokenTtl,
      refreshToken: session.refreshToken,
      user: toUser(user),
    };
  }
}
