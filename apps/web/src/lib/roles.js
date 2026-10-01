/**
 * School roles and who may do what, mirroring the API's rules so the page only offers what the
 * server will allow. The ranks match ROLE_RANK in @grand/contracts, which isn't imported here
 * because it would bring zod into the main bundle.
 */
export const ROLE_RANK = { student: 0, instructor: 1, admin: 2, owner: 3 };

export const ROLE_LABELS = { owner: 'Owner', admin: 'Admin', instructor: 'Instructor', student: 'Student' };

const ASSIGNABLE = ['admin', 'instructor', 'student'];

/** True when `actor` ranks strictly above `role`. */
export const outranks = (actor, role) => (ROLE_RANK[actor] ?? -1) > (ROLE_RANK[role] ?? Infinity);

/** Admins and the owner see the members and invitations. */
export const isManager = (role) => (ROLE_RANK[role] ?? -1) >= ROLE_RANK.admin;

/** The roles `actor` can give (by invitation or a change): only those below their own. */
export const assignableRoles = (actor) => (isManager(actor) ? ASSIGNABLE.filter((role) => outranks(actor, role)) : []);

/**
 * Whether `actor` can change `target`'s role or remove them: never their own, never the owner's,
 * and only for people below them (admins manage instructors and students; the owner, everyone).
 */
export const canManage = (actor, target, isSelf = false) => !isSelf && isManager(actor) && outranks(actor, target);

/** Instructors, admins and the owner create courses (and edit their own; admins edit them all). */
export const canCreateCourses = (role) => (ROLE_RANK[role] ?? -1) >= ROLE_RANK.instructor;

/** Anyone can leave a school except its owner. */
export const canLeave = (role) => Boolean(role) && role !== 'owner';

/** "an admin", "a student". */
export const withArticle = (role) => `${/^[aeiou]/i.test(ROLE_LABELS[role] ?? '') ? 'an' : 'a'} ${(ROLE_LABELS[role] ?? role).toLowerCase()}`;
