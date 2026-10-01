import { HttpStatus, Injectable } from '@nestjs/common';
import {
  type AssignableRole,
  type CreateSchoolInput,
  type ListQuery,
  type Member,
  type MySchool,
  type Page,
  type PublicSchool,
  ROLE_RANK,
  type Role,
} from '@grand/contracts';
import { and, asc, count, eq, sql } from 'drizzle-orm';
import { ApiException, forbidden, notFound } from '../common/api-exception.js';
import { badCursor, decodeCursor, encodeCursor } from '../common/cursor.js';
import type { SchoolContext } from '../common/request-context.js';
import { DatabaseService, type Tx } from '../database/database.service.js';
import { isUniqueViolation } from '../database/errors.js';
import { assignmentSubmissions, memberships, schools, users } from '../database/schema.js';
import { AuditService } from '../events/audit.service.js';
import { OutboxService } from '../events/outbox.service.js';
import { AppConfig } from '../config/app-config.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { scheduleSubmissionFileDeletion } from '../storage/submission-files.js';

type SchoolRow = typeof schools.$inferSelect;

export const toPublicSchool = (row: Pick<SchoolRow, 'id' | 'slug' | 'name' | 'createdAt'>): PublicSchool => ({
  id: row.id,
  slug: row.slug,
  name: row.name,
  createdAt: row.createdAt.toISOString(),
});

const TIMESTAMP = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,6})?[+-]\d{2}(:\d{2})?$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Switches the transaction to act for a school it has just created or proven access to. */
export async function actForSchool(tx: Tx, schoolId: string) {
  await tx.execute(sql`select set_config('app.school_id', ${schoolId}, true)`);
}

@Injectable()
export class SchoolsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly realtime: RealtimeService,
    private readonly config: AppConfig,
  ) {}

  async create(userId: string, input: CreateSchoolInput, ip: string | null): Promise<MySchool> {
    try {
      return await this.db.transaction({ userId }, async (tx) => {
        // Locks the person's row, so two simultaneous requests can't both pass the limit below.
        await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for('update');
        const [owned] = await tx
          .select({ total: count() })
          .from(memberships)
          .where(and(eq(memberships.userId, userId), eq(memberships.role, 'owner')));
        if ((owned?.total ?? 0) >= this.config.maxSchoolsPerOwner) {
          throw new ApiException(HttpStatus.FORBIDDEN, 'limit_reached', `You can own up to ${this.config.maxSchoolsPerOwner} schools.`);
        }
        const [school] = await tx.insert(schools).values({ slug: input.slug, name: input.name, createdBy: userId }).returning();
        await actForSchool(tx, school!.id);
        await tx.insert(memberships).values({ schoolId: school!.id, userId, role: 'owner' });
        await this.audit.record(tx, { action: 'school.created', actorId: userId, schoolId: school!.id, targetType: 'school', targetId: school!.id, ip });
        await this.outbox.add(tx, 'school.created', { schoolId: school!.id, ownerId: userId }, school!.id);
        return { ...toPublicSchool(school!), role: 'owner' as const };
      });
    } catch (error) {
      if (isUniqueViolation(error, 'schools_slug_key')) {
        throw new ApiException(HttpStatus.CONFLICT, 'slug_taken', 'This address is taken. Try another one.', [
          { path: 'slug', message: 'This address is taken' },
        ]);
      }
      throw error;
    }
  }

  async publicBySlug(slug: string): Promise<PublicSchool> {
    const [school] = await this.db.transaction({}, (tx) => tx.select().from(schools).where(eq(schools.slug, slug)));
    if (!school) throw notFound('This school');
    return toPublicSchool(school);
  }

  /** Every school the person belongs to, with their role, oldest membership first. */
  async mine(userId: string): Promise<MySchool[]> {
    const rows = await this.db.transaction({ userId }, (tx) =>
      tx
        .select({ school: schools, role: memberships.role })
        .from(memberships)
        .innerJoin(schools, eq(schools.id, memberships.schoolId))
        .where(eq(memberships.userId, userId))
        .orderBy(asc(memberships.createdAt)),
    );
    return rows.map(({ school, role }) => ({ ...toPublicSchool(school), role }));
  }

  /** The school with this address and the person's role in it (null when not a member). */
  async access(userId: string, slug: string): Promise<(Omit<SchoolContext, 'role'> & { role: Role | null }) | null> {
    const [row] = await this.db.transaction({ userId }, (tx) =>
      tx
        .select({ school: schools, role: memberships.role })
        .from(schools)
        .leftJoin(memberships, and(eq(memberships.schoolId, schools.id), eq(memberships.userId, userId)))
        .where(eq(schools.slug, slug)),
    );
    if (!row) return null;
    const { id, name, createdAt } = row.school;
    return { id, slug: row.school.slug, name, createdAt, role: row.role };
  }

  async members(school: SchoolContext, userId: string, query: ListQuery): Promise<Page<Member>> {
    const after = query.cursor ? decodeCursor(query.cursor, 2) : null;
    if (after && (!TIMESTAMP.test(after[0]!) || !UUID.test(after[1]!))) throw badCursor();
    const rows = await this.db.transaction({ userId, schoolId: school.id }, (tx) =>
      tx
        .select({
          userId: memberships.userId,
          role: memberships.role,
          joinedAt: memberships.createdAt,
          // The exact value (microseconds), so the next page starts precisely after this row.
          position: sql<string>`${memberships.createdAt}::text`,
          name: users.name,
          email: users.email,
        })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .where(
          and(
            eq(memberships.schoolId, school.id),
            after ? sql`(${memberships.createdAt}, ${memberships.userId}) > (${after[0]}::timestamptz, ${after[1]}::uuid)` : undefined,
          ),
        )
        .orderBy(asc(memberships.createdAt), asc(memberships.userId))
        .limit(query.limit + 1),
    );
    const page = rows.slice(0, query.limit);
    const last = rows.length > query.limit ? page.at(-1) : undefined;
    return {
      items: page.map(({ position: _position, ...row }) => ({ ...row, joinedAt: row.joinedAt.toISOString() })),
      nextCursor: last ? encodeCursor([last.position, last.userId]) : null,
    };
  }

  /**
   * Changes a member's role. Nobody changes their own role or the owner's, and people can only
   * manage roles below their own: admins manage instructors and students, the owner everyone.
   */
  async updateMember(school: SchoolContext, actorId: string, targetId: string, role: AssignableRole, ip: string | null): Promise<Member> {
    if (targetId === actorId) throw forbidden("You can't change your own role.");
    const member = await this.db.transaction({ userId: actorId, schoolId: school.id }, async (tx) => {
      const current = await this.memberForUpdate(tx, school.id, targetId);
      if (!outranks(school.role, current.role) || !outranks(school.role, role)) {
        throw forbidden(school.role === 'admin' ? 'Only the owner can manage admins.' : "You can't manage this member.");
      }
      const [updated] = await tx
        .update(memberships)
        .set({ role })
        .where(and(eq(memberships.schoolId, school.id), eq(memberships.userId, targetId)))
        .returning({ createdAt: memberships.createdAt });
      await this.audit.record(tx, {
        action: 'member.role_changed',
        actorId,
        schoolId: school.id,
        targetType: 'user',
        targetId,
        ip,
        data: { from: current.role, to: role },
      });
      return { userId: targetId, name: current.name, email: current.email, role, joinedAt: updated!.createdAt.toISOString() };
    });
    this.realtime.emitToSchool(school.id, 'school:member-updated', { schoolId: school.id, userId: targetId, role });
    this.realtime.changeRole(targetId, school.id, role);
    return member;
  }

  /** Removes a member, or lets a member leave. The owner can't leave or be removed. */
  async removeMember(school: SchoolContext, actorId: string, targetId: string, ip: string | null): Promise<void> {
    const leaving = targetId === actorId;
    await this.db.transaction({ userId: actorId, schoolId: school.id }, async (tx) => {
      const current = await this.memberForUpdate(tx, school.id, targetId);
      if (current.role === 'owner') throw forbidden(leaving ? 'The owner can’t leave their own school.' : 'The owner can’t be removed.');
      if (!leaving && (ROLE_RANK[school.role] < ROLE_RANK.admin || !outranks(school.role, current.role))) {
        throw forbidden("You can't remove this member.");
      }
      // Their submissions go with the membership; their files are cleared away too.
      await scheduleSubmissionFileDeletion(tx, this.outbox, school.id, and(eq(assignmentSubmissions.schoolId, school.id), eq(assignmentSubmissions.userId, targetId)));
      await tx.delete(memberships).where(and(eq(memberships.schoolId, school.id), eq(memberships.userId, targetId)));
      await this.audit.record(tx, {
        action: leaving ? 'member.left' : 'member.removed',
        actorId,
        schoolId: school.id,
        targetType: 'user',
        targetId,
        ip,
        data: { role: current.role },
      });
    });
    // Told first, while the removed person is still in the room, then taken out of it.
    this.realtime.emitToSchool(school.id, 'school:member-removed', { schoolId: school.id, userId: targetId });
    this.realtime.leaveSchool(targetId, school.id);
  }

  private async memberForUpdate(tx: Tx, schoolId: string, userId: string) {
    // Locks the membership, so two admins changing the same person can't interleave.
    const [row] = await tx
      .select({ role: memberships.role, name: users.name, email: users.email })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(and(eq(memberships.schoolId, schoolId), eq(memberships.userId, userId)))
      .for('update', { of: memberships });
    if (!row) throw notFound('This member');
    return row;
  }
}

/** True when `actor` ranks strictly above `role`. */
export const outranks = (actor: Role, role: Role) => ROLE_RANK[actor] > ROLE_RANK[role];
