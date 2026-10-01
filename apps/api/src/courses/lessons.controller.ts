import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  type CompleteUploadInput,
  type CreateLessonInput,
  type Lesson,
  type LessonSummary,
  type Playback,
  type StartUploadInput,
  type UpdateLessonInput,
  type UploadTicket,
  completeUploadInput,
  courseSlug,
  createLessonInput,
  startUploadInput,
  updateLessonInput,
  uploadPartsInput,
  uuid,
} from '@grand/contracts';
import { type AuthContext, type ClientInfo, type SchoolContext, Client, CurrentAuth, CurrentSchool } from '../common/request-context.js';
import { HOUR, MINUTE, RateLimit } from '../rate-limit/rate-limit.decorator.js';
import { SchoolRole } from '../schools/school-access.guard.js';
import { LessonsService } from './lessons.service.js';
import { MediaService } from './media.service.js';
import { PlaybackService } from './playback.service.js';

@ApiTags('lessons')
@Controller('schools/:slug/courses/:courseSlug/lessons')
export class LessonsController {
  constructor(
    private readonly lessons: LessonsService,
    private readonly media: MediaService,
    private readonly playback: PlaybackService,
  ) {}

  @Post()
  @SchoolRole('instructor')
  @ApiOperation({ summary: 'Add a lesson at the end of a module' })
  create(
    @Param('courseSlug', { schema: courseSlug }) slug: string,
    @Body({ schema: createLessonInput }) body: CreateLessonInput,
    @CurrentSchool() school: SchoolContext,
    @CurrentAuth() auth: AuthContext,
    @Client() client: ClientInfo,
  ): Promise<LessonSummary> {
    return this.lessons.create(school, auth.userId, slug, body, client.ip);
  }

  @Get(':lessonId')
  @SchoolRole('student')
  @ApiOperation({ summary: 'A lesson with its notes (enrolled members, previews, and editors)' })
  get(
    @Param('courseSlug', { schema: courseSlug }) slug: string,
    @Param('lessonId', { schema: uuid }) lessonId: string,
    @CurrentSchool() school: SchoolContext,
    @CurrentAuth() auth: AuthContext,
  ): Promise<Lesson> {
    return this.lessons.get(school, auth.userId, slug, lessonId);
  }

  @Patch(':lessonId')
  @SchoolRole('instructor')
  @ApiOperation({ summary: 'Change a lesson: title, notes, publishing, preview, or its video on another platform' })
  update(
    @Param('courseSlug', { schema: courseSlug }) slug: string,
    @Param('lessonId', { schema: uuid }) lessonId: string,
    @Body({ schema: updateLessonInput }) body: UpdateLessonInput,
    @CurrentSchool() school: SchoolContext,
    @CurrentAuth() auth: AuthContext,
    @Client() client: ClientInfo,
  ): Promise<Lesson> {
    return this.lessons.update(school, auth.userId, slug, lessonId, body, client.ip);
  }

  @Delete(':lessonId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @SchoolRole('instructor')
  @ApiOperation({ summary: 'Delete a lesson and its video' })
  async remove(
    @Param('courseSlug', { schema: courseSlug }) slug: string,
    @Param('lessonId', { schema: uuid }) lessonId: string,
    @CurrentSchool() school: SchoolContext,
    @CurrentAuth() auth: AuthContext,
    @Client() client: ClientInfo,
  ): Promise<void> {
    await this.lessons.remove(school, auth.userId, slug, lessonId, client.ip);
  }

  @Get(':lessonId/playback')
  @SchoolRole('student')
  @RateLimit({ name: 'playback', limit: 120, windowMs: MINUTE })
  @ApiOperation({ summary: "How to play the lesson's video: an HLS address, an embed, or its processing state" })
  play(
    @Param('courseSlug', { schema: courseSlug }) slug: string,
    @Param('lessonId', { schema: uuid }) lessonId: string,
    @CurrentSchool() school: SchoolContext,
    @CurrentAuth() auth: AuthContext,
  ): Promise<Playback> {
    return this.playback.forLesson(school, auth.userId, slug, lessonId);
  }

  @Post(':lessonId/upload')
  @SchoolRole('instructor')
  @RateLimit({ name: 'upload', limit: 30, windowMs: HOUR })
  @ApiOperation({ summary: "Start uploading the lesson's video: returns signed URLs for its parts" })
  startUpload(
    @Param('courseSlug', { schema: courseSlug }) slug: string,
    @Param('lessonId', { schema: uuid }) lessonId: string,
    @Body({ schema: startUploadInput }) body: StartUploadInput,
    @CurrentSchool() school: SchoolContext,
    @CurrentAuth() auth: AuthContext,
    @Client() client: ClientInfo,
  ): Promise<UploadTicket> {
    return this.media.start(school, auth.userId, slug, lessonId, body, client.ip);
  }

  @Post(':lessonId/upload/:assetId/parts')
  @HttpCode(HttpStatus.OK)
  @SchoolRole('instructor')
  @ApiOperation({ summary: 'Fresh URLs for parts not sent yet' })
  moreParts(
    @Param('courseSlug', { schema: courseSlug }) slug: string,
    @Param('lessonId', { schema: uuid }) lessonId: string,
    @Param('assetId', { schema: uuid }) assetId: string,
    @Body({ schema: uploadPartsInput }) body: { partNumbers: number[] },
    @CurrentSchool() school: SchoolContext,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.media.moreParts(school, auth.userId, slug, lessonId, assetId, body.partNumbers);
  }

  @Post(':lessonId/upload/:assetId/complete')
  @HttpCode(HttpStatus.OK)
  @SchoolRole('instructor')
  @ApiOperation({ summary: 'Finish the upload; the video is then transcoded' })
  complete(
    @Param('courseSlug', { schema: courseSlug }) slug: string,
    @Param('lessonId', { schema: uuid }) lessonId: string,
    @Param('assetId', { schema: uuid }) assetId: string,
    @Body({ schema: completeUploadInput }) body: CompleteUploadInput,
    @CurrentSchool() school: SchoolContext,
    @CurrentAuth() auth: AuthContext,
    @Client() client: ClientInfo,
  ): Promise<LessonSummary> {
    return this.media.complete(school, auth.userId, slug, lessonId, assetId, body, client.ip);
  }

  @Delete(':lessonId/upload/:assetId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @SchoolRole('instructor')
  @ApiOperation({ summary: 'Cancel an upload in progress' })
  async abort(
    @Param('courseSlug', { schema: courseSlug }) slug: string,
    @Param('lessonId', { schema: uuid }) lessonId: string,
    @Param('assetId', { schema: uuid }) assetId: string,
    @CurrentSchool() school: SchoolContext,
    @CurrentAuth() auth: AuthContext,
  ): Promise<void> {
    await this.media.abort(school, auth.userId, slug, lessonId, assetId);
  }
}
