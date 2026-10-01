import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  type AuthSession,
  type DeviceSession,
  type LoginInput,
  type Me,
  type SignupInput,
  loginInput,
  signupInput,
  uuid,
} from '@grand/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ApiException, notFound } from '../common/api-exception.js';
import { type AuthContext, type ClientInfo, Client, CurrentAuth, Public } from '../common/request-context.js';
import { AppConfig } from '../config/app-config.js';
import { HOUR, MINUTE, RateLimit } from '../rate-limit/rate-limit.decorator.js';
import { AuthService, type IssuedSession } from './auth.service.js';
import { SessionsService } from './sessions.service.js';

/** Only the auth routes ever receive the refresh cookie. */
const COOKIE_PATH = '/api/v1/auth';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionsService,
    private readonly config: AppConfig,
  ) {}

  @Public()
  @Post('signup')
  @HttpCode(HttpStatus.CREATED)
  @RateLimit({ name: 'signup', limit: 10, windowMs: HOUR, by: 'ip' })
  @ApiOperation({ summary: 'Create an account and sign in' })
  async signup(
    @Body({ schema: signupInput }) body: SignupInput,
    @Client() client: ClientInfo,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<AuthSession> {
    return this.respond(reply, await this.auth.signup(body, client));
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ name: 'login', limit: 30, windowMs: 15 * MINUTE, by: 'ip' })
  @ApiOperation({ summary: 'Sign in with email and password' })
  async login(
    @Body({ schema: loginInput }) body: LoginInput,
    @Client() client: ClientInfo,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<AuthSession> {
    return this.respond(reply, await this.auth.login(body, client));
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ name: 'refresh', limit: 60, windowMs: MINUTE, by: 'ip' })
  @ApiCookieAuth()
  @ApiOperation({ summary: 'Get a new access token with the refresh cookie (rotates the cookie)' })
  async refresh(
    @Req() request: FastifyRequest,
    @Client() client: ClientInfo,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<AuthSession> {
    this.assertTrustedOrigin(request);
    const token = request.cookies[this.cookieName];
    if (!token) throw new ApiException(HttpStatus.UNAUTHORIZED, 'session_expired', 'Please sign in.');
    try {
      return this.respond(reply, await this.auth.refresh(token, client));
    } catch (error) {
      // Only a refused token ends the cookie; a passing outage mustn't sign anyone out.
      if (error instanceof ApiException && error.getStatus() === HttpStatus.UNAUTHORIZED) this.clearCookie(reply);
      throw error;
    }
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiCookieAuth()
  @ApiOperation({ summary: 'Sign out this device' })
  async logout(@Req() request: FastifyRequest, @Client() client: ClientInfo, @Res({ passthrough: true }) reply: FastifyReply) {
    this.assertTrustedOrigin(request);
    const token = request.cookies[this.cookieName];
    if (token) await this.sessions.endByRefreshToken(token, client);
    this.clearCookie(reply);
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'The signed-in person and their schools' })
  me(@CurrentAuth() auth: AuthContext): Promise<Me> {
    return this.auth.me(auth.userId);
  }

  @Get('sessions')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Devices signed in to this account' })
  listSessions(@CurrentAuth() auth: AuthContext): Promise<DeviceSession[]> {
    return this.sessions.list(auth.userId, auth.sessionId);
  }

  @Delete('sessions/:sessionId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Sign out a device' })
  async endSession(
    @Param('sessionId', { schema: uuid }) sessionId: string,
    @CurrentAuth() auth: AuthContext,
    @Client() client: ClientInfo,
  ) {
    if (!(await this.sessions.end(auth.userId, sessionId, client))) throw notFound('This session');
  }

  private get cookieName() {
    // The __Secure- prefix makes browsers refuse the cookie unless it's Secure and set over HTTPS.
    return this.config.auth.cookieSecure ? '__Secure-grand_rt' : 'grand_rt';
  }

  private respond(reply: FastifyReply, session: IssuedSession): AuthSession {
    reply.setCookie(this.cookieName, session.refreshToken, {
      httpOnly: true,
      secure: this.config.auth.cookieSecure,
      sameSite: 'strict',
      path: COOKIE_PATH,
      maxAge: Math.floor(this.config.auth.refreshTokenTtlMs / 1000),
    });
    return { accessToken: session.accessToken, expiresIn: session.expiresIn, user: session.user };
  }

  private clearCookie(reply: FastifyReply) {
    reply.clearCookie(this.cookieName, { path: COOKIE_PATH, secure: this.config.auth.cookieSecure, httpOnly: true, sameSite: 'strict' });
  }

  /**
   * The cookie routes also require the web app's Origin: SameSite=Strict already keeps other sites'
   * requests from carrying the cookie, and this refuses anything that isn't a browser on the app.
   */
  private assertTrustedOrigin(request: FastifyRequest) {
    const origin = request.headers.origin;
    if (!origin || !this.config.webOrigins.includes(origin)) {
      throw new ApiException(HttpStatus.FORBIDDEN, 'forbidden', 'This request must come from the Grand LMS app.');
    }
  }
}
