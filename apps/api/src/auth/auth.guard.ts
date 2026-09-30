import { type CanActivate, type ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { ApiException, unauthenticated } from '../common/api-exception.js';
import { IS_PUBLIC } from '../common/request-context.js';
import { SessionsService } from './sessions.service.js';
import { AccessTokenError, TokenService } from './token.service.js';

const BEARER = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/;

/**
 * Every route needs a valid access token unless it's marked @Public(). An expired token gets
 * `session_expired`, which tells the web app to refresh and retry once.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly sessions: SessionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [context.getHandler(), context.getClass()]) ?? false;
    const header = request.headers.authorization;

    if (!header) {
      if (isPublic) return true;
      throw unauthenticated();
    }
    const token = BEARER.exec(header)?.[1];
    try {
      if (!token) throw new AccessTokenError(false);
      const auth = await this.tokens.verify(token);
      if (await this.sessions.isRevoked(auth.sessionId)) throw new AccessTokenError(true);
      request.auth = auth;
      return true;
    } catch (error) {
      // A public route works for anyone, so a bad token there is simply ignored.
      if (isPublic) return true;
      if (error instanceof AccessTokenError && error.expired) {
        throw new ApiException(HttpStatus.UNAUTHORIZED, 'session_expired', 'Your session has expired.');
      }
      throw unauthenticated();
    }
  }
}
