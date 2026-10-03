import { z } from 'zod';
import { plainText } from './courses.js';
import type { Role } from './schools.js';

/**
 * Discussions: course threads (a title and a first post), comments under lessons, and replies to
 * either, one level deep. The course's editors moderate: they pin and lock threads, hide posts,
 * mark the reply that answers a question, and deal with reports.
 */

const body = plainText(10_000).pipe(z.string().min(1, 'Write something first'));
const title = z.string().trim().min(3, 'Use at least 3 characters').max(150, 'Use at most 150 characters');

export const newThreadInput = z.strictObject({ title, body });
export type NewThreadInput = z.infer<typeof newThreadInput>;

export const newPostInput = z.strictObject({ body });
export type NewPostInput = z.infer<typeof newPostInput>;

/** An author's edit: the text, and for a thread its title. */
export const editPostInput = z.strictObject({ title: title.optional(), body });
export type EditPostInput = z.infer<typeof editPostInput>;

/** What a moderator can change. Pinning and locking apply to threads and lesson comments; accepting to replies. */
export const moderatePostInput = z
  .strictObject({
    pinned: z.boolean(),
    locked: z.boolean(),
    hidden: z.boolean(),
    accepted: z.boolean(),
  })
  .partial()
  .refine((input) => Object.keys(input).length > 0, 'Change at least one thing');
export type ModeratePostInput = z.infer<typeof moderatePostInput>;

export const REPORT_REASONS = ['spam', 'abuse', 'off_topic', 'other'] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export const reportPostInput = z.strictObject({
  reason: z.enum(REPORT_REASONS),
  note: plainText(500).default(''),
});
export type ReportPostInput = z.infer<typeof reportPostInput>;

export const resolveReportInput = z.strictObject({ action: z.enum(['hide', 'dismiss']) });
export type ResolveReportInput = z.infer<typeof resolveReportInput>;

export const DISCUSSION_SORTS = ['activity', 'new', 'top'] as const;
export const discussionQuery = z.strictObject({
  /** activity: latest activity first; new: newest first; top: most helpful first. Pinned always lead. */
  sort: z.enum(DISCUSSION_SORTS).default('activity'),
  /** unanswered: threads without an accepted reply; mine: threads I started or replied to. */
  filter: z.enum(['all', 'unanswered', 'mine']).default('all'),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type DiscussionQuery = z.infer<typeof discussionQuery>;

export interface DiscussionAuthor {
  id: string;
  name: string;
  role: Role | null;
  /** Edits this course (its author, or an admin): shown as "Instructor". */
  instructor: boolean;
}

export interface DiscussionPost {
  id: string;
  courseId: string;
  lessonId: string | null;
  parentId: string | null;
  /** Course threads only. */
  title: string | null;
  /** Empty when deleted, or hidden from this viewer. */
  body: string;
  /** Null once the author has left the school. */
  author: DiscussionAuthor | null;
  status: 'visible' | 'hidden' | 'deleted';
  pinned: boolean;
  locked: boolean;
  accepted: boolean;
  replyCount: number;
  voteCount: number;
  /** The viewer found it helpful. */
  voted: boolean;
  createdAt: string;
  editedAt: string | null;
  lastActivityAt: string;
  /** The viewer wrote it, so may edit and delete it. */
  mine: boolean;
  /** The viewer moderates this course. */
  canModerate: boolean;
  /** Open reports, for moderators (0 for everyone else). */
  reportCount: number;
  /** The viewer has reported it (once per person, so they can't again). */
  reported: boolean;
  /** A thread or comment with a visible reply accepted as the answer; false for replies. */
  answered: boolean;
}

/** A thread or lesson comment with its replies, oldest first. */
export interface DiscussionThread extends DiscussionPost {
  replies: DiscussionPost[];
  /** For lesson comments, the lesson. */
  lesson: { id: string; title: string } | null;
}

export interface DiscussionPage<T = DiscussionPost> {
  items: T[];
  nextCursor: string | null;
}

export interface DiscussionReport {
  id: string;
  reason: ReportReason;
  note: string;
  reporter: { id: string; name: string } | null;
  createdAt: string;
  post: DiscussionPost;
  /** Where the post is: its thread, or the lesson it's under. */
  context: { threadId: string; threadTitle: string | null; lessonId: string | null; lessonTitle: string | null };
}
