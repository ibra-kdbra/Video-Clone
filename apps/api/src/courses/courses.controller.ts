import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  type Course,
  type CourseSummary,
  type CreateCourseInput,
  type Enrollment,
  type ModuleInput,
  type OutlineInput,
  type StorageUsage,
  type UpdateCourseInput,
  catalogQuery,
  courseSlug,
  createCourseInput,
  moduleInput,
  outlineInput,
  updateCourseInput,
  uuid,
} from '@grand/contracts';
import { type AuthContext, type ClientInfo, type SchoolContext, Client, CurrentAuth, CurrentSchool } from '../common/request-context.js';
import { HOUR, RateLimit } from '../rate-limit/rate-limit.decorator.js';
import { SchoolRole } from '../schools/school-access.guard.js';
import { CoursesService } from './courses.service.js';
import { LessonsService } from './lessons.service.js';
import { MediaService } from './media.service.js';

@ApiTags('courses')
@Controller('schools/:slug')
export class CoursesController {
  constructor(
    private readonly courses: CoursesService,
    private readonly lessons: LessonsService,
    private readonly media: MediaService,
  ) {}

  @Get('courses')
  @SchoolRole('student')
  @ApiOperation({ summary: "The school's courses: published ones, plus drafts for their editors" })
  catalog(
    @Query({ schema: catalogQuery }) query: { status?: 'draft' | 'published' | 'archived'; mine?: 'true' | 'false' },
    @CurrentSchool() school: SchoolContext,
    @CurrentAuth() auth: AuthContext,
  ): Promise<CourseSummary[]> {
    return this.courses.catalog(school, auth.userId, { status: query.status, mine: query.mine === 'true' });
  }

  @Post('courses')
  @SchoolRole('instructor')
  @RateLimit({ name: 'create-course', limit: 60, windowMs: HOUR })
  @ApiOperation({ summary: 'Create a course (instructors and above)' })
  create(
    @Body({ schema: createCourseInput }) body: CreateCourseInput,
    @CurrentSchool() school: SchoolContext,
    @CurrentAuth() auth: AuthContext,
    @Client() client: ClientInfo,
  ): Promise<Course> {
    return this.courses.create(school, auth.userId, body, client.ip);
  }

  @Get('courses/:courseSlug')
  @SchoolRole('student')
  @ApiOperation({ summary: 'A course and its outline' })
  get(@Param('courseSlug', { schema: courseSlug }) slug: string, @CurrentSchool() school: SchoolContext, @CurrentAuth() auth: AuthContext): Promise<Course> {
    return this.courses.get(school, auth.userId, slug);
  }

  @Patch('courses/:courseSlug')
  @SchoolRole('instructor')
  @ApiOperation({ summary: 'Change a course: title, address, summary, description, or publish it' })
  update(
    @Param('courseSlug', { schema: courseSlug }) slug: string,
    @Body({ schema: updateCourseInput }) body: UpdateCourseInput,
    @CurrentSchool() school: SchoolContext,
    @CurrentAuth() auth: AuthContext,
    @Client() client: ClientInfo,
  ): Promise<Course> {
    return this.courses.update(school, auth.userId, slug, body, client.ip);
  }

  @Delete('courses/:courseSlug')
  @HttpCode(HttpStatus.NO_CONTENT)
  @SchoolRole('instructor')
  @ApiOperation({ summary: 'Delete a course, its lessons and their videos' })
  async remove(
    @Param('courseSlug', { schema: courseSlug }) slug: string,
    @CurrentSchool() school: SchoolContext,
    @CurrentAuth() auth: AuthContext,
    @Client() client: ClientInfo,
  ): Promise<void> {
    await this.courses.remove(school, auth.userId, slug, client.ip);
  }

  @Post('courses/:courseSlug/modules')
  @SchoolRole('instructor')
  @ApiOperation({ summary: 'Add a module at the end of the course' })
  addModule(
    @Param('courseSlug', { schema: courseSlug }) slug: string,
    @Body({ schema: moduleInput }) body: ModuleInput,
    @CurrentSchool() school: SchoolContext,
    @CurrentAuth() auth: AuthContext,
  ): Promise<Course> {
    return this.courses.addModule(school, auth.userId, slug, body);
  }

  @Patch('courses/:courseSlug/modules/:moduleId')
  @SchoolRole('instructor')
  @ApiOperation({ summary: 'Rename a module' })
  renameModule(
    @Param('courseSlug', { schema: courseSlug }) slug: string,
    @Param('moduleId', { schema: uuid }) moduleId: string,
    @Body({ schema: moduleInput }) body: ModuleInput,
    @CurrentSchool() school: SchoolContext,
    @CurrentAuth() auth: AuthContext,
  ): Promise<Course> {
    return this.courses.renameModule(school, auth.userId, slug, moduleId, body);
  }

  @Delete('courses/:courseSlug/modules/:moduleId')
  @SchoolRole('instructor')
  @ApiOperation({ summary: 'Delete a module and its lessons' })
  removeModule(
    @Param('courseSlug', { schema: courseSlug }) slug: string,
    @Param('moduleId', { schema: uuid }) moduleId: string,
    @CurrentSchool() school: SchoolContext,
    @CurrentAuth() auth: AuthContext,
    @Client() client: ClientInfo,
  ): Promise<Course> {
    return this.courses.removeModule(school, auth.userId, slug, moduleId, client.ip);
  }

  @Put('courses/:courseSlug/outline')
  @SchoolRole('instructor')
  @ApiOperation({ summary: 'Reorder modules and lessons (the whole outline, in its new order)' })
  reorder(
    @Param('courseSlug', { schema: courseSlug }) slug: string,
    @Body({ schema: outlineInput }) body: OutlineInput,
    @CurrentSchool() school: SchoolContext,
    @CurrentAuth() auth: AuthContext,
  ): Promise<Course> {
    return this.courses.reorder(school, auth.userId, slug, body);
  }

  @Post('courses/:courseSlug/enrollment')
  @HttpCode(HttpStatus.NO_CONTENT)
  @SchoolRole('student')
  @ApiOperation({ summary: 'Enroll in a published course' })
  async enroll(@Param('courseSlug', { schema: courseSlug }) slug: string, @CurrentSchool() school: SchoolContext, @CurrentAuth() auth: AuthContext): Promise<void> {
    await this.lessons.enroll(school, auth.userId, slug);
  }

  @Delete('courses/:courseSlug/enrollment')
  @HttpCode(HttpStatus.NO_CONTENT)
  @SchoolRole('student')
  @ApiOperation({ summary: 'Leave a course' })
  async unenroll(@Param('courseSlug', { schema: courseSlug }) slug: string, @CurrentSchool() school: SchoolContext, @CurrentAuth() auth: AuthContext): Promise<void> {
    await this.lessons.unenroll(school, auth.userId, slug);
  }

  @Get('courses/:courseSlug/enrollments')
  @SchoolRole('instructor')
  @ApiOperation({ summary: "Who is enrolled (the course's editors)" })
  enrollments(
    @Param('courseSlug', { schema: courseSlug }) slug: string,
    @CurrentSchool() school: SchoolContext,
    @CurrentAuth() auth: AuthContext,
  ): Promise<Enrollment[]> {
    return this.lessons.enrollments(school, auth.userId, slug);
  }

  @Get('storage')
  @SchoolRole('instructor')
  @ApiOperation({ summary: "The school's video storage: quota, used and reserved" })
  storage(@CurrentSchool() school: SchoolContext, @CurrentAuth() auth: AuthContext): Promise<StorageUsage> {
    return this.media.usage(school, auth.userId);
  }
}
