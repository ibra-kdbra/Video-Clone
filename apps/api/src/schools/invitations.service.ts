import { HttpStatus, Injectable } from '@nestjs/common';
import type { CreateInvitationInput, Invitation, InvitationPreview, MySchool } from '@grand/contracts';
import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { ApiException, forbidden, notFound } from '../common/api-exception.js';
import { hashToken, randomToken } from '../common/crypto.js';
import type { SchoolContext } from '../common/request-context.js';
import { AppConfig } from '../config/app-config.js';
import { DatabaseService, type Tx } from '../database/database.service.js';
import { isUniqueViolation } from '../database/errors.js';
import { invitations, memberships, schools, users } from '../database/schema.js';
import { AuditService } from '../events/audit.service.js';
import { OutboxService } from '../events/outbox.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { actForSchool, outranks, toPublicSchool } from './schools.service.js';

const INVITATION_TTL_MS = 7 * 86_400_000;

type TokenRow = {
  id: string;
  school_id: string;
  email: string;
  role: 'admin' | 'instructor' | 'student';
  invited_by: string | null;
  expires_at: Date;
  accepted_at: Date | null;
  revoked_at: Date | null;
};

const invalidInvitation = () =>
  new ApiException(HttpStatus.NOT_FOUND, 'invitation_invalid', 'This invitation has expired or was already used. Ask for a new one.');

/** a***@example.com: enough to recognize your own address, not enough to harvest it. */
export function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@');
  return `${local.slice(0, 1)}${'*'.repeat(Math.max(2, Math.min(local.length - 1, 6)))}@${domain}`;
}

@Injectable()
export class InvitationsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly realtime: RealtimeService,
    private readonly config: AppConfig,
  ) {}

  /**
   * Invites an address to the school. Admins invite instructors and students; the owner may also
   * invite admins. Inviting the same address again replaces the earlier link. The link itself only
   * ever leaves the server in the email (the outbox event is scrubbed once it's sent).
   */
  async create(school: SchoolContext, actorId: string, input: CreateInvitationInput, ip: string | null): Promise<Invitation> {
    if (!outranks(school.role, input.role)) throw forbidden('Only the owner can invite admins.');
    const token = randomToken();
    try {
      return await this.invite(school, actorId, input, token, ip);
    } catch (error) {
      // Two admins inviting the same address at the same moment: the second one loses the race.
      if (isUniqueViolation(error, 'invitations_open_key')) {
        throw new ApiException(HttpStatus.CONFLICT, 'conflict', 'An invitation to this address was just sent. Refresh to see it.');
      }
      throw error;
    }
  }

  private invite(school: SchoolContext, actorId: string, input: CreateInvitationInput, token: string, ip: string | null): Promise<Invitation> {
    return this.db.transaction({ userId: actorId, schoolId: school.id }, async (tx) => {
      const [member] = await tx
        .select({ userId: memberships.userId })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .where(and(eq(memberships.schoolId, school.id), eq(users.email, input.email)));
      if (member) throw new ApiException(HttpStatus.CONFLICT, 'already_member', 'This person is already a member of the school.');

      await tx
        .update(invitations)
        .set({ revokedAt: sql`now()` })
        .where(and(eq(invitations.schoolId, school.id), eq(invitations.email, input.email), isNull(invitations.acceptedAt), isNull(invitations.revokedAt)));
      const [invitation] = await tx
        .insert(invitations)
        .values({
          schoolId: school.id,
          email: input.email,
          role: input.role,
          tokenHash: hashToken(token),
          invitedBy: actorId,
          expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
        })
        .returning();
      const [inviter] = await tx.select({ id: users.id, name: users.name }).from(users).where(eq(users.id, actorId));

      await this.outbox.add(
        tx,
        'invitation.created',
        {
          invitationId: invitation!.id,
          email: input.email,
          role: input.role,
          schoolName: school.name,
          inviterName: inviter?.name ?? null,
          url: `${this.config.publicWebUrl}/invite#${token}`,
          expiresAt: invitation!.expiresAt.toISOString(),
        },
        school.id,
      );
      await this.audit.record(tx, {
        action: 'invitation.created',
        actorId,
        schoolId: school.id,
        targetType: 'invitation',
        targetId: invitation!.id,
        ip,
        data: { email: input.email, role: input.role },
      });
      return {
        id: invitation!.id,
        email: invitation!.email,
        role: input.role,
        invitedBy: inviter ?? null,
        createdAt: invitation!.createdAt.toISOString(),
        expiresAt: invitation!.expiresAt.toISOString(),
      };
    });
  }

  /** Open invitations: not accepted, not revoked and not expired, newest first. */
  async list(school: SchoolContext, actorId: string): Promise<Invitation[]> {
    const inviter = alias(users, 'inviter');
    const rows = await this.db.transaction({ userId: actorId, schoolId: school.id }, (tx) =>
      tx
        .select({ invitation: invitations, inviterName: inviter.name })
        .from(invitations)
        .leftJoin(inviter, eq(inviter.id, invitations.invitedBy))
        .where(
          and(
            eq(invitations.schoolId, school.id),
            isNull(invitations.acceptedAt),
            isNull(invitations.revokedAt),
            gt(invitations.expiresAt, sql`now()`),
          ),
        )
        .orderBy(desc(invitations.createdAt))
        .limit(200),
    );
    return rows.map(({ invitation, inviterName }) => ({
      id: invitation.id,
      email: invitation.email,
      role: invitation.role as Invitation['role'],
      invitedBy: invitation.invitedBy && inviterName ? { id: invitation.invitedBy, name: inviterName } : null,
      createdAt: invitation.createdAt.toISOString(),
      expiresAt: invitation.expiresAt.toISOString(),
    }));
  }

  async revoke(school: SchoolContext, actorId: string, invitationId: string, ip: string | null): Promise<void> {
    await this.db.transaction({ userId: actorId, schoolId: school.id }, async (tx) => {
      const [revoked] = await tx
        .update(invitations)
        .set({ revokedAt: sql`now()` })
        .where(and(eq(invitations.id, invitationId), eq(invitations.schoolId, school.id), isNull(invitations.acceptedAt), isNull(invitations.revokedAt)))
        .returning({ id: invitations.id, role: invitations.role });
      if (!revoked) throw notFound('This invitation');
      if (!outranks(school.role, revoked.role)) throw forbidden('Only the owner can manage admin invitations.');
      await this.audit.record(tx, { action: 'invitation.revoked', actorId, schoolId: school.id, targetType: 'invitation', targetId: invitationId, ip });
    });
  }

  /** What the invitation page shows before someone accepts (no sign-in needed). */
  async preview(token: string): Promise<InvitationPreview> {
    return this.db.transaction({}, async (tx) => {
      const invitation = await this.findUsable(tx, token);
      const [school] = await tx.select().from(schools).where(eq(schools.id, invitation.school_id));
      const [inviter] = invitation.invited_by
        ? await tx.select({ name: users.name }).from(users).where(eq(users.id, invitation.invited_by))
        : [];
      if (!school) throw invalidInvitation();
      return {
        school: { slug: school.slug, name: school.name },
        role: invitation.role,
        email: maskEmail(invitation.email),
        invitedBy: inviter?.name ?? null,
        expiresAt: invitation.expires_at.toISOString(),
      };
    });
  }

  /**
   * Joins the school with the invitation's role. The signed-in account's email must be the one
   * invited, which also proves the person reads that inbox, so the address is marked verified.
   */
  async accept(userId: string, token: string, ip: string | null): Promise<MySchool> {
    const { school, member } = await this.db.transaction({ userId }, async (tx) => {
      const invitation = await this.findUsable(tx, token);
      const [user] = await tx.select().from(users).where(eq(users.id, userId));
      if (!user) throw notFound('This account');
      if (user.email !== invitation.email) {
        throw new ApiException(HttpStatus.FORBIDDEN, 'invitation_email_mismatch', `This invitation was sent to ${maskEmail(invitation.email)}. Sign in with that address to accept it.`);
      }

      await actForSchool(tx, invitation.school_id);
      // Claiming the invitation is one atomic update, so a link can't be used twice.
      const [claimed] = await tx
        .update(invitations)
        .set({ acceptedAt: sql`now()`, acceptedBy: userId })
        .where(and(eq(invitations.id, invitation.id), isNull(invitations.acceptedAt), isNull(invitations.revokedAt), gt(invitations.expiresAt, sql`now()`)))
        .returning({ id: invitations.id });
      if (!claimed) throw invalidInvitation();

      const inserted = await tx
        .insert(memberships)
        .values({ schoolId: invitation.school_id, userId, role: invitation.role })
        .onConflictDoNothing()
        .returning({ createdAt: memberships.createdAt });
      if (!inserted.length) throw new ApiException(HttpStatus.CONFLICT, 'already_member', "You're already a member of this school.");

      await tx.update(users).set({ emailVerifiedAt: sql`coalesce(${users.emailVerifiedAt}, now())` }).where(eq(users.id, userId));
      const [school] = await tx.select().from(schools).where(eq(schools.id, invitation.school_id));
      await this.audit.record(tx, {
        action: 'invitation.accepted',
        actorId: userId,
        schoolId: invitation.school_id,
        targetType: 'invitation',
        targetId: invitation.id,
        ip,
        data: { role: invitation.role },
      });
      await this.outbox.add(tx, 'member.joined', { schoolId: invitation.school_id, userId, role: invitation.role }, invitation.school_id);
      return {
        school: { ...toPublicSchool(school!), role: invitation.role },
        member: { userId, name: user.name, email: user.email, role: invitation.role, joinedAt: inserted[0]!.createdAt.toISOString() },
      };
    });
    this.realtime.emitToSchool(school.id, 'school:member-joined', { schoolId: school.id, member });
    return school;
  }

  private async findUsable(tx: Tx, token: string): Promise<TokenRow> {
    const rows = await tx.execute<TokenRow>(sql`select * from app.invitation_by_token(${hashToken(token)})`);
    const row = rows[0];
    if (!row || row.accepted_at || row.revoked_at || new Date(row.expires_at) <= new Date()) throw invalidInvitation();
    return { ...row, expires_at: new Date(row.expires_at) };
  }
}
