import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  type CreateInvitationInput,
  type Invitation,
  type InvitationPreview,
  type MySchool,
  acceptInvitationInput,
  createInvitationInput,
  uuid,
} from '@grand/contracts';
import { type AuthContext, type ClientInfo, type SchoolContext, Client, CurrentAuth, CurrentSchool, Public } from '../common/request-context.js';
import { HOUR, MINUTE, RateLimit } from '../rate-limit/rate-limit.decorator.js';
import { InvitationsService } from './invitations.service.js';
import { SchoolRole } from './school-access.guard.js';

@ApiTags('invitations')
@Controller()
export class InvitationsController {
  constructor(private readonly invitations: InvitationsService) {}

  @Post('schools/:slug/invitations')
  @SchoolRole('admin')
  @RateLimit({ name: 'invite', limit: 100, windowMs: HOUR })
  @ApiOperation({ summary: 'Invite someone by email' })
  create(
    @Body({ schema: createInvitationInput }) body: CreateInvitationInput,
    @CurrentSchool() school: SchoolContext,
    @CurrentAuth() auth: AuthContext,
    @Client() client: ClientInfo,
  ): Promise<Invitation> {
    return this.invitations.create(school, auth.userId, body, client.ip);
  }

  @Get('schools/:slug/invitations')
  @SchoolRole('admin')
  @ApiOperation({ summary: 'Open invitations' })
  list(@CurrentSchool() school: SchoolContext, @CurrentAuth() auth: AuthContext): Promise<Invitation[]> {
    return this.invitations.list(school, auth.userId);
  }

  @Delete('schools/:slug/invitations/:invitationId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @SchoolRole('admin')
  @ApiOperation({ summary: 'Cancel an invitation' })
  async revoke(
    @Param('invitationId', { schema: uuid }) invitationId: string,
    @CurrentSchool() school: SchoolContext,
    @CurrentAuth() auth: AuthContext,
    @Client() client: ClientInfo,
  ): Promise<void> {
    await this.invitations.revoke(school, auth.userId, invitationId, client.ip);
  }

  // The token travels in the body, never the URL, so it stays out of logs and Referer headers.
  @Public()
  @Post('invitations/preview')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ name: 'invitation-lookup', limit: 30, windowMs: 10 * MINUTE, by: 'ip' })
  @ApiOperation({ summary: 'What an invitation link is for' })
  preview(@Body({ schema: acceptInvitationInput }) body: { token: string }): Promise<InvitationPreview> {
    return this.invitations.preview(body.token);
  }

  @Post('invitations/accept')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @RateLimit({ name: 'invitation-lookup', limit: 30, windowMs: 10 * MINUTE, by: 'ip' })
  @ApiOperation({ summary: 'Accept an invitation and join the school' })
  accept(
    @Body({ schema: acceptInvitationInput }) body: { token: string },
    @CurrentAuth() auth: AuthContext,
    @Client() client: ClientInfo,
  ): Promise<MySchool> {
    return this.invitations.accept(auth.userId, body.token, client.ip);
  }
}
