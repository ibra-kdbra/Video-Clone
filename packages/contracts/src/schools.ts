import { z } from 'zod';
import { email, uuid } from './common.js';

export const ROLES = ['owner', 'admin', 'instructor', 'student'] as const;
export type Role = (typeof ROLES)[number];

/** Roles that can be given by invitation or changed later. There is exactly one owner. */
export const ASSIGNABLE_ROLES = ['admin', 'instructor', 'student'] as const;
export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];

/** How much each role may do; a higher rank includes everything below it. */
export const ROLE_RANK: Record<Role, number> = { student: 0, instructor: 1, admin: 2, owner: 3 };

/** Paths the web app uses itself, so no school can take them as its address. */
export const RESERVED_SLUGS = new Set([
  'admin', 'api', 'app', 'auth', 'billing', 'dashboard', 'docs', 'help', 'invite', 'invitations',
  'login', 'logout', 'me', 'new', 'schools', 'settings', 'signin', 'signup', 'static', 'status',
  'support', 'www',
]);

/** A school's address, as in /s/{slug}: 3-40 lower-case letters, digits and single hyphens. */
export const schoolSlug = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, 'Use at least 3 characters')
  .max(40, 'Use at most 40 characters')
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lower-case letters, numbers and single hyphens')
  .refine((slug) => !RESERVED_SLUGS.has(slug), 'This address is reserved');

export const schoolName = z
  .string()
  .trim()
  .min(2, 'Use at least 2 characters')
  .max(80, 'Use at most 80 characters')
  .regex(/^[^\p{Cc}\p{Cf}]*$/u, 'Use letters, numbers and punctuation only');

export const createSchoolInput = z.strictObject({ name: schoolName, slug: schoolSlug });
export type CreateSchoolInput = z.infer<typeof createSchoolInput>;

export const schoolSlugParam = z.strictObject({ slug: schoolSlug });
export const memberParams = z.strictObject({ slug: schoolSlug, userId: uuid });
export const invitationParams = z.strictObject({ slug: schoolSlug, invitationId: uuid });

export const updateMemberInput = z.strictObject({ role: z.enum(ASSIGNABLE_ROLES) });
export type UpdateMemberInput = z.infer<typeof updateMemberInput>;

export const createInvitationInput = z.strictObject({
  email,
  role: z.enum(ASSIGNABLE_ROLES),
});
export type CreateInvitationInput = z.infer<typeof createInvitationInput>;

/** Invitation tokens are 32 random bytes, base64url-encoded (43 characters). */
export const invitationToken = z.string().regex(/^[A-Za-z0-9_-]{43}$/, 'This invitation link is not valid');
export const invitationTokenParam = z.strictObject({ token: invitationToken });
export const acceptInvitationInput = z.strictObject({ token: invitationToken });

export const listQuery = z.strictObject({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type ListQuery = z.infer<typeof listQuery>;

export interface PublicSchool {
  id: string;
  slug: string;
  name: string;
  createdAt: string;
}

/** A school as one of its members sees it in their list. */
export interface MySchool extends PublicSchool {
  role: Role;
}

export interface Member {
  userId: string;
  name: string;
  email: string;
  role: Role;
  joinedAt: string;
}

export interface Page<T> {
  items: T[];
  /** Pass as `cursor` to get the next page; null on the last page. */
  nextCursor: string | null;
}

export interface Invitation {
  id: string;
  email: string;
  role: AssignableRole;
  invitedBy: { id: string; name: string } | null;
  createdAt: string;
  expiresAt: string;
}

/** What someone holding an invitation link may see before accepting it. */
export interface InvitationPreview {
  school: { slug: string; name: string };
  role: AssignableRole;
  /** The invited address, partly hidden (a***@example.com). */
  email: string;
  invitedBy: string | null;
  expiresAt: string;
}
