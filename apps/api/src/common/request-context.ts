import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Role } from '@grand/contracts';
import type { FastifyRequest } from 'fastify';

/** The signed-in person and device behind a request (from the access token). */
export interface AuthContext {
  userId: string;
  sessionId: string;
}

/** The school a request acts in, and the caller's role there (set by SchoolAccessGuard). */
export interface SchoolContext {
  id: string;
  slug: string;
  name: string;
  createdAt: Date;
  role: Role;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AuthContext;
    school?: SchoolContext;
    /** The visitor's address as best known (see CLIENT_IP_HEADER), for rate limits and audit. */
    clientIp: string;
  }
}

export const IS_PUBLIC = 'grand:public';
/** The route works without signing in (a valid token is still read when present). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const CurrentAuth = createParamDecorator((_data: unknown, context: ExecutionContext): AuthContext => {
  const auth = context.switchToHttp().getRequest<FastifyRequest>().auth;
  if (!auth) throw new Error('CurrentAuth used on a public route');
  return auth;
});

export const CurrentSchool = createParamDecorator((_data: unknown, context: ExecutionContext): SchoolContext => {
  const school = context.switchToHttp().getRequest<FastifyRequest>().school;
  if (!school) throw new Error('CurrentSchool used without @SchoolRole');
  return school;
});

export interface ClientInfo {
  ip: string | null;
  userAgent: string | null;
}

export const Client = createParamDecorator((_data: unknown, context: ExecutionContext): ClientInfo => {
  const request = context.switchToHttp().getRequest<FastifyRequest>();
  const userAgent = request.headers['user-agent'];
  return { ip: request.clientIp || null, userAgent: typeof userAgent === 'string' ? userAgent.slice(0, 512) : null };
});
