import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  type CreateSchoolInput,
  type ListQuery,
  type Member,
  type MySchool,
  type Page,
  type PublicSchool,
  type UpdateMemberInput,
  createSchoolInput,
  listQuery,
  schoolSlug,
  updateMemberInput,
  uuid,
} from '@grand/contracts';
import { type AuthContext, type ClientInfo, type SchoolContext, Client, CurrentAuth, CurrentSchool, Public } from '../common/request-context.js';
import { HOUR, RateLimit } from '../rate-limit/rate-limit.decorator.js';
import { SchoolRole } from './school-access.guard.js';
import { SchoolsService, toPublicSchool } from './schools.service.js';

@ApiTags('schools')
@Controller('schools')
export class SchoolsController {
  constructor(private readonly schools: SchoolsService) {}

  @Post()
  @ApiBearerAuth()
  @RateLimit({ name: 'create-school', limit: 10, windowMs: HOUR })
  @ApiOperation({ summary: 'Create a school; you become its owner' })
  create(
    @Body({ schema: createSchoolInput }) body: CreateSchoolInput,
    @CurrentAuth() auth: AuthContext,
    @Client() client: ClientInfo,
  ): Promise<MySchool> {
    return this.schools.create(auth.userId, body, client.ip);
  }

  @Public()
  @Get(':slug/public')
  @ApiOperation({ summary: "A school's public details, for its landing page" })
  publicInfo(@Param('slug', { schema: schoolSlug }) slug: string): Promise<PublicSchool> {
    return this.schools.publicBySlug(slug);
  }

  @Get(':slug')
  @SchoolRole('student')
  @ApiOperation({ summary: 'A school you belong to, with your role' })
  get(@CurrentSchool() school: SchoolContext): MySchool {
    return { ...toPublicSchool(school), role: school.role };
  }

  @Get(':slug/members')
  @SchoolRole('admin')
  @ApiOperation({ summary: "The school's members, oldest first (admins and the owner)" })
  members(
    @Query({ schema: listQuery }) query: ListQuery,
    @CurrentSchool() school: SchoolContext,
    @CurrentAuth() auth: AuthContext,
  ): Promise<Page<Member>> {
    return this.schools.members(school, auth.userId, query);
  }

  @Patch(':slug/members/:userId')
  @SchoolRole('admin')
  @ApiOperation({ summary: "Change a member's role" })
  updateMember(
    @Param('userId', { schema: uuid }) userId: string,
    @Body({ schema: updateMemberInput }) body: UpdateMemberInput,
    @CurrentSchool() school: SchoolContext,
    @CurrentAuth() auth: AuthContext,
    @Client() client: ClientInfo,
  ): Promise<Member> {
    return this.schools.updateMember(school, auth.userId, userId, body.role, client.ip);
  }

  @Delete(':slug/members/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @SchoolRole('student')
  @ApiOperation({ summary: 'Remove a member, or leave the school (your own id)' })
  async removeMember(
    @Param('userId', { schema: uuid }) userId: string,
    @CurrentSchool() school: SchoolContext,
    @CurrentAuth() auth: AuthContext,
    @Client() client: ClientInfo,
  ): Promise<void> {
    await this.schools.removeMember(school, auth.userId, userId, client.ip);
  }
}
