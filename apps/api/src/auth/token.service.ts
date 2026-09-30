import { Injectable } from '@nestjs/common';
import { errors, jwtVerify, SignJWT } from 'jose';
import { z } from 'zod';
import type { AuthContext } from '../common/request-context.js';
import { AppConfig } from '../config/app-config.js';

const ISSUER = 'grand-lms';
const AUDIENCE = 'grand-lms:api';
const claims = z.object({ sub: z.uuid(), sid: z.uuid() });

export class AccessTokenError extends Error {
  constructor(readonly expired: boolean) {
    super(expired ? 'Access token expired' : 'Access token invalid');
  }
}

/**
 * Short-lived access tokens: signed JWTs (HS256) naming the person and their session. They're kept
 * in the browser's memory only; the long-lived refresh token stays in an httpOnly cookie.
 */
@Injectable()
export class TokenService {
  constructor(private readonly config: AppConfig) {}

  get accessTokenTtl() {
    return this.config.auth.accessTokenTtl;
  }

  sign({ userId, sessionId }: AuthContext): Promise<string> {
    return new SignJWT({ sid: sessionId })
      .setProtectedHeader({ alg: 'HS256', typ: 'at+jwt' })
      .setSubject(userId)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(`${this.accessTokenTtl}s`)
      .sign(this.config.auth.jwtSecret);
  }

  async verify(token: string): Promise<AuthContext> {
    try {
      const { payload } = await jwtVerify(token, this.config.auth.jwtSecret, {
        algorithms: ['HS256'],
        issuer: ISSUER,
        audience: AUDIENCE,
        typ: 'at+jwt',
        clockTolerance: 5,
        requiredClaims: ['sub', 'sid', 'iat', 'exp'],
      });
      const { sub, sid } = claims.parse(payload);
      return { userId: sub, sessionId: sid };
    } catch (error) {
      throw new AccessTokenError(error instanceof errors.JWTExpired);
    }
  }
}
