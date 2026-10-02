import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  courseSlug,
  type CreateLiveSessionInput,
  createLiveSessionInput,
  type LiveKitAccess,
  type LiveMessage,
  type LiveOptions,
  type LiveScheduleQuery,
  type LiveSession,
  liveMessagesQuery,
  liveScheduleQuery,
  liveSpeakerInput,
  type UpdateLiveSessionInput,
  updateLiveSessionInput,
  uuid,
} from '@grand/contracts';
import type { z } from 'zod';
import { type AuthContext, type ClientInfo, type SchoolContext, Client, CurrentAuth, CurrentSchool } from '../common/request-context.js';
import { HOUR, MINUTE, RateLimit } from '../rate-limit/rate-limit.decorator.js';
import { SchoolRole } from '../schools/school-access.guard.js';
import { LiveService } from './live.service.js';

/** The school-wide schedule and the server's options. */
@ApiTags('live')
@Controller('schools/:slug/live')
export class LiveScheduleController {
  constructor(private readonly live: LiveService) {}

  @Get('options')
  @SchoolRole('student')
  @ApiOperation({ summary: 'Which video providers this server offers for live classes' })
  options(): LiveOptions {
    return this.live.options();
  }

  @Get()
  @SchoolRole('student')
  @ApiOperation({ summary: 'Live classes in the courses you take or teach' })
  schedule(@Query({ schema: liveScheduleQuery }) query: LiveScheduleQuery, @CurrentSchool() school: SchoolContext, @CurrentAuth() auth: AuthContext): Promise<LiveSession[]> {
    return this.live.schedule(school, auth.userId, query);
  }
}

/** A course's live classes. */
@ApiTags('live')
@Controller('schools/:slug/courses/:courseSlug/live')
export class LiveController {
  constructor(private readonly live: LiveService) {}

  @Get()
  @SchoolRole('student')
  @ApiOperation({ summary: "A course's live classes" })
  list(
    @Param('courseSlug', { schema: courseSlug }) slug: string,
    @Query({ schema: liveScheduleQuery }) query: LiveScheduleQuery,
    @CurrentSchool() school: SchoolContext,
    @CurrentAuth() auth: AuthContext,
  ): Promise<LiveSession[]> {
    return this.live.list(school, auth.userId, slug, query);
  }

  @Post()
  @SchoolRole('instructor')
  @RateLimit({ name: 'live-schedule', limit: 60, windowMs: HOUR })
  @ApiOperation({ summary: 'Schedule a live class (the course’s editors)' })
  create(
    @Param('courseSlug', { schema: courseSlug }) slug: string,
    @Body({ schema: createLiveSessionInput }) body: CreateLiveSessionInput,
    @CurrentSchool() school: SchoolContext,
    @CurrentAuth() auth: AuthContext,
    @Client() client: ClientInfo,
  ): Promise<LiveSession> {
    return this.live.create(school, auth.userId, slug, body, client.ip);
  }

  @Get(':sessionId')
  @SchoolRole('student')
  @ApiOperation({ summary: 'A live class' })
  get(
    @Param('courseSlug', { schema: courseSlug }) slug: string,
    @Param('sessionId', { schema: uuid }) sessionId: string,
    @CurrentSchool() school: SchoolContext,
    @CurrentAuth() auth: AuthContext,
  ): Promise<LiveSession> {
    return this.live.get(school, auth.userId, slug, sessionId);
  }

  @Patch(':sessionId')
  @SchoolRole('instructor')
  @ApiOperation({ summary: "Change a class: details, stream, recording" })
  update(
    @Param('courseSlug', { schema: courseSlug }) slug: string,
    @Param('sessionId', { schema: uuid }) sessionId: string,
    @Body({ schema: updateLiveSessionInput }) body: UpdateLiveSessionInput,
    @CurrentSchool() school: SchoolContext,
    @CurrentAuth() auth: AuthContext,
  ): Promise<LiveSession> {
    return this.live.update(school, auth.userId, slug, sessionId, body);
  }

  @Post(':sessionId/start')
  @SchoolRole('instructor')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Go live' })
  start(
    @Param('courseSlug', { schema: courseSlug }) slug: string,
    @Param('sessionId', { schema: uuid }) sessionId: string,
    @CurrentSchool() school: SchoolContext,
    @CurrentAuth() auth: AuthContext,
    @Client() client: ClientInfo,
  ): Promise<LiveSession> {
    return this.live.start(school, auth.userId, slug, sessionId, client.ip);
  }

  @Post(':sessionId/end')
  @SchoolRole('instructor')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'End the class' })
  end(
    @Param('courseSlug', { schema: courseSlug }) slug: string,
    @Param('sessionId', { schema: uuid }) sessionId: string,
    @CurrentSchool() school: SchoolContext,
    @CurrentAuth() auth: AuthContext,
    @Client() client: ClientInfo,
  ): Promise<LiveSession> {
    return this.live.end(school, auth.userId, slug, sessionId, client.ip);
  }

  @Post(':sessionId/cancel')
  @SchoolRole('instructor')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel a class that hasn’t started' })
  cancel(
    @Param('courseSlug', { schema: courseSlug }) slug: string,
    @Param('sessionId', { schema: uuid }) sessionId: string,
    @CurrentSchool() school: SchoolContext,
    @CurrentAuth() auth: AuthContext,
    @Client() client: ClientInfo,
  ): Promise<LiveSession> {
    return this.live.cancel(school, auth.userId, slug, sessionId, client.ip);
  }

  @Delete(':sessionId')
  @SchoolRole('instructor')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a class that never happened' })
  remove(
    @Param('courseSlug', { schema: courseSlug }) slug: string,
    @Param('sessionId', { schema: uuid }) sessionId: string,
    @CurrentSchool() school: SchoolContext,
    @CurrentAuth() auth: AuthContext,
    @Client() client: ClientInfo,
  ): Promise<void> {
    return this.live.remove(school, auth.userId, slug, sessionId, client.ip);
  }

  @Get(':sessionId/messages')
  @SchoolRole('student')
  @ApiOperation({ summary: "The class chat's history, newest last" })
  messages(
    @Param('courseSlug', { schema: courseSlug }) slug: string,
    @Param('sessionId', { schema: uuid }) sessionId: string,
    @Query({ schema: liveMessagesQuery }) query: z.infer<typeof liveMessagesQuery>,
    @CurrentSchool() school: SchoolContext,
    @CurrentAuth() auth: AuthContext,
  ): Promise<LiveMessage[]> {
    return this.live.messages(school, auth.userId, slug, sessionId, query);
  }

  @Post(':sessionId/messages/:messageId/hide')
  @SchoolRole('instructor')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Hide a chat message' })
  hideMessage(
    @Param('courseSlug', { schema: courseSlug }) slug: string,
    @Param('sessionId', { schema: uuid }) sessionId: string,
    @Param('messageId', { schema: uuid }) messageId: string,
    @CurrentSchool() school: SchoolContext,
    @CurrentAuth() auth: AuthContext,
  ): Promise<void> {
    return this.live.hideMessage(school, auth.userId, slug, sessionId, messageId);
  }

  @Get(':sessionId/attendance')
  @SchoolRole('instructor')
  @ApiOperation({ summary: 'Who came to the class' })
  attendance(
    @Param('courseSlug', { schema: courseSlug }) slug: string,
    @Param('sessionId', { schema: uuid }) sessionId: string,
    @CurrentSchool() school: SchoolContext,
    @CurrentAuth() auth: AuthContext,
  ): Promise<{ userId: string; name: string; joinedAt: string; lastSeenAt: string }[]> {
    return this.live.attendance(school, auth.userId, slug, sessionId);
  }

  @Post(':sessionId/token')
  @SchoolRole('student')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ name: 'live-token', limit: 60, windowMs: MINUTE })
  @ApiOperation({ summary: 'A LiveKit token to join the class in the browser' })
  token(
    @Param('courseSlug', { schema: courseSlug }) slug: string,
    @Param('sessionId', { schema: uuid }) sessionId: string,
    @CurrentSchool() school: SchoolContext,
    @CurrentAuth() auth: AuthContext,
  ): Promise<LiveKitAccess> {
    return this.live.token(school, auth.userId, slug, sessionId);
  }

  @Post(':sessionId/speakers/:userId')
  @SchoolRole('instructor')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Let a student speak, or stop them' })
  speaker(
    @Param('courseSlug', { schema: courseSlug }) slug: string,
    @Param('sessionId', { schema: uuid }) sessionId: string,
    @Param('userId', { schema: uuid }) studentId: string,
    @Body({ schema: liveSpeakerInput }) body: { allowed: boolean },
    @CurrentSchool() school: SchoolContext,
    @CurrentAuth() auth: AuthContext,
  ): Promise<void> {
    return this.live.setSpeaker(school, auth.userId, slug, sessionId, studentId, body.allowed);
  }
}
