import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  courseSlug,
  type DiscussionPage,
  type DiscussionPost,
  type DiscussionQuery,
  type DiscussionReport,
  type DiscussionThread,
  discussionQuery,
  type EditPostInput,
  editPostInput,
  type ModeratePostInput,
  moderatePostInput,
  type NewPostInput,
  newPostInput,
  type NewThreadInput,
  newThreadInput,
  type ReportPostInput,
  reportPostInput,
  type ResolveReportInput,
  resolveReportInput,
  uuid,
} from '@grand/contracts';
import { type AuthContext, type ClientInfo, type SchoolContext, Client, CurrentAuth, CurrentSchool } from '../common/request-context.js';
import { HOUR, MINUTE, RateLimit } from '../rate-limit/rate-limit.decorator.js';
import { SchoolRole } from '../schools/school-access.guard.js';
import { DiscussionsService } from './discussions.service.js';

const POSTING = { name: 'discussion-post', limit: 30, windowMs: 10 * MINUTE };

/** Course threads, lesson comments, replies, and their moderation. */
@ApiTags('discussions')
@Controller('schools/:slug/courses/:courseSlug')
export class DiscussionsController {
  constructor(private readonly discussions: DiscussionsService) {}

  @Get('discussions')
  @SchoolRole('student')
  @ApiOperation({ summary: "The course's threads, pinned first" })
  threads(
    @Param('courseSlug', { schema: courseSlug }) slug: string,
    @Query({ schema: discussionQuery }) query: DiscussionQuery,
    @CurrentSchool() school: SchoolContext,
    @CurrentAuth() auth: AuthContext,
  ): Promise<DiscussionPage> {
    return this.discussions.threads(school, auth.userId, slug, query);
  }

  @Post('discussions')
  @SchoolRole('student')
  @RateLimit(POSTING)
  @ApiOperation({ summary: 'Start a thread' })
  createThread(
    @Param('courseSlug', { schema: courseSlug }) slug: string,
    @Body({ schema: newThreadInput }) body: NewThreadInput,
    @CurrentSchool() school: SchoolContext,
    @CurrentAuth() auth: AuthContext,
  ): Promise<DiscussionThread> {
    return this.discussions.createThread(school, auth.userId, slug, body);
  }

  @Get('discussions/reports')
  @SchoolRole('instructor')
  @ApiOperation({ summary: 'Open reports, for the course’s editors' })
  reports(@Param('courseSlug', { schema: courseSlug }) slug: string, @CurrentSchool() school: SchoolContext, @CurrentAuth() auth: AuthContext): Promise<DiscussionReport[]> {
    return this.discussions.reports(school, auth.userId, slug);
  }

  @Post('discussions/reports/:reportId/resolve')
  @SchoolRole('instructor')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Hide the reported post, or dismiss the report' })
  resolve(
    @Param('courseSlug', { schema: courseSlug }) slug: string,
    @Param('reportId', { schema: uuid }) reportId: string,
    @Body({ schema: resolveReportInput }) body: ResolveReportInput,
    @CurrentSchool() school: SchoolContext,
    @CurrentAuth() auth: AuthContext,
    @Client() client: ClientInfo,
  ): Promise<void> {
    return this.discussions.resolve(school, auth.userId, slug, reportId, body, client.ip);
  }

  @Get('discussions/:postId')
  @SchoolRole('student')
  @ApiOperation({ summary: 'A thread or lesson comment with its replies' })
  thread(
    @Param('courseSlug', { schema: courseSlug }) slug: string,
    @Param('postId', { schema: uuid }) postId: string,
    @CurrentSchool() school: SchoolContext,
    @CurrentAuth() auth: AuthContext,
  ): Promise<DiscussionThread> {
    return this.discussions.thread(school, auth.userId, slug, postId);
  }

  @Post('discussions/:postId/replies')
  @SchoolRole('student')
  @RateLimit(POSTING)
  @ApiOperation({ summary: 'Reply to a thread or lesson comment' })
  reply(
    @Param('courseSlug', { schema: courseSlug }) slug: string,
    @Param('postId', { schema: uuid }) postId: string,
    @Body({ schema: newPostInput }) body: NewPostInput,
    @CurrentSchool() school: SchoolContext,
    @CurrentAuth() auth: AuthContext,
  ): Promise<DiscussionPost> {
    return this.discussions.reply(school, auth.userId, slug, postId, body);
  }

  @Patch('discussions/:postId')
  @SchoolRole('student')
  @RateLimit(POSTING)
  @ApiOperation({ summary: 'Edit your post' })
  edit(
    @Param('courseSlug', { schema: courseSlug }) slug: string,
    @Param('postId', { schema: uuid }) postId: string,
    @Body({ schema: editPostInput }) body: EditPostInput,
    @CurrentSchool() school: SchoolContext,
    @CurrentAuth() auth: AuthContext,
  ): Promise<DiscussionPost> {
    return this.discussions.edit(school, auth.userId, slug, postId, body);
  }

  @Delete('discussions/:postId')
  @SchoolRole('student')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a post (yours, or any as a moderator)' })
  remove(
    @Param('courseSlug', { schema: courseSlug }) slug: string,
    @Param('postId', { schema: uuid }) postId: string,
    @CurrentSchool() school: SchoolContext,
    @CurrentAuth() auth: AuthContext,
    @Client() client: ClientInfo,
  ): Promise<void> {
    return this.discussions.remove(school, auth.userId, slug, postId, client.ip);
  }

  @Put('discussions/:postId/vote')
  @SchoolRole('student')
  @RateLimit({ name: 'discussion-vote', limit: 120, windowMs: MINUTE })
  @ApiOperation({ summary: 'Mark a post helpful' })
  vote(
    @Param('courseSlug', { schema: courseSlug }) slug: string,
    @Param('postId', { schema: uuid }) postId: string,
    @CurrentSchool() school: SchoolContext,
    @CurrentAuth() auth: AuthContext,
  ): Promise<{ voteCount: number; voted: boolean }> {
    return this.discussions.vote(school, auth.userId, slug, postId, true);
  }

  @Delete('discussions/:postId/vote')
  @SchoolRole('student')
  @RateLimit({ name: 'discussion-vote', limit: 120, windowMs: MINUTE })
  @ApiOperation({ summary: 'Take back "helpful"' })
  unvote(
    @Param('courseSlug', { schema: courseSlug }) slug: string,
    @Param('postId', { schema: uuid }) postId: string,
    @CurrentSchool() school: SchoolContext,
    @CurrentAuth() auth: AuthContext,
  ): Promise<{ voteCount: number; voted: boolean }> {
    return this.discussions.vote(school, auth.userId, slug, postId, false);
  }

  @Post('discussions/:postId/moderate')
  @SchoolRole('instructor')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Pin, lock, hide, or mark as the answer (the course’s editors)' })
  moderate(
    @Param('courseSlug', { schema: courseSlug }) slug: string,
    @Param('postId', { schema: uuid }) postId: string,
    @Body({ schema: moderatePostInput }) body: ModeratePostInput,
    @CurrentSchool() school: SchoolContext,
    @CurrentAuth() auth: AuthContext,
    @Client() client: ClientInfo,
  ): Promise<DiscussionPost> {
    return this.discussions.moderate(school, auth.userId, slug, postId, body, client.ip);
  }

  @Post('discussions/:postId/report')
  @SchoolRole('student')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RateLimit({ name: 'discussion-report', limit: 20, windowMs: HOUR })
  @ApiOperation({ summary: "Report a post to the course's editors" })
  report(
    @Param('courseSlug', { schema: courseSlug }) slug: string,
    @Param('postId', { schema: uuid }) postId: string,
    @Body({ schema: reportPostInput }) body: ReportPostInput,
    @CurrentSchool() school: SchoolContext,
    @CurrentAuth() auth: AuthContext,
  ): Promise<void> {
    return this.discussions.report(school, auth.userId, slug, postId, body);
  }

  @Get('lessons/:lessonId/comments')
  @SchoolRole('student')
  @ApiOperation({ summary: "A lesson's comments, with their replies" })
  comments(
    @Param('courseSlug', { schema: courseSlug }) slug: string,
    @Param('lessonId', { schema: uuid }) lessonId: string,
    @Query({ schema: discussionQuery }) query: DiscussionQuery,
    @CurrentSchool() school: SchoolContext,
    @CurrentAuth() auth: AuthContext,
  ): Promise<DiscussionPage<DiscussionThread>> {
    return this.discussions.comments(school, auth.userId, slug, lessonId, query);
  }

  @Post('lessons/:lessonId/comments')
  @SchoolRole('student')
  @RateLimit(POSTING)
  @ApiOperation({ summary: 'Comment on a lesson' })
  comment(
    @Param('courseSlug', { schema: courseSlug }) slug: string,
    @Param('lessonId', { schema: uuid }) lessonId: string,
    @Body({ schema: newPostInput }) body: NewPostInput,
    @CurrentSchool() school: SchoolContext,
    @CurrentAuth() auth: AuthContext,
  ): Promise<DiscussionThread> {
    return this.discussions.createComment(school, auth.userId, slug, lessonId, body);
  }
}
