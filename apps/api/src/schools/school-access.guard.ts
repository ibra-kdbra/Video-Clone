import { applyDecorators, type CanActivate, type ExecutionContext, Injectable, SetMetadata, UseGuards } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiBearerAuth } from '@nestjs/swagger';
import { ROLE_RANK, type Role, schoolSlug } from '@grand/contracts';
import type { FastifyRequest } from 'fastify';
import { forbidden, notFound, unauthenticated } from '../common/api-exception.js';
import { SchoolsService } from './schools.service.js';

const SCHOOL_ROLE = 'grand:school-role';

/**
 * The route acts inside the school named by its `:slug`, and needs at least `role` there. The
 * school and the caller's role are then available through @CurrentSchool().
 */
export const SchoolRole = (role: Role) => applyDecorators(SetMetadata(SCHOOL_ROLE, role), UseGuards(SchoolAccessGuard), ApiBearerAuth());

@Injectable()
export class SchoolAccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly schools: SchoolsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest<{ Params: { slug?: string } }>>();
    if (!request.auth) throw unauthenticated();
    const needed = this.reflector.get<Role>(SCHOOL_ROLE, context.getHandler()) ?? 'student';
    const slug = schoolSlug.safeParse(request.params.slug);
    if (!slug.success) throw notFound('This school');

    const school = await this.schools.access(request.auth.userId, slug.data);
    if (!school) throw notFound('This school');
    if (!school.role) throw forbidden("You're not a member of this school.");
    if (ROLE_RANK[school.role] < ROLE_RANK[needed]) throw forbidden(`Only a school ${needed} or above can do this.`);
    request.school = { ...school, role: school.role };
    return true;
  }
}
