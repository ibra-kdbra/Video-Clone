import { HttpStatus, Injectable } from '@nestjs/common';
import {
  type DiscussionAuthor,
  type DiscussionPage,
  type DiscussionPost,
  type DiscussionQuery,
  type DiscussionReport,
  type DiscussionThread,
  type EditPostInput,
  type ModeratePostInput,
  type NewPostInput,
  type NewThreadInput,
  type ReportPostInput,
  type ResolveReportInput,
  ROLE_RANK,
  type Role,
} from '@grand/contracts';
import { and, eq, isNull, sql, type SQL } from 'drizzle-orm';
import { ApiException, forbidden, notFound } from '../common/api-exception.js';
import { badCursor, decodeCursor, encodeCursor } from '../common/cursor.js';
import type { SchoolContext } from '../common/request-context.js';
import { DatabaseService, type Tx } from '../database/database.service.js';
import { discussionPosts, discussionReports, discussionVotes } from '../database/schema.js';
import { canEditCourse } from '../courses/course-access.js';
import { type CourseRecord, CoursesService } from '../courses/courses.service.js';
import { enrollmentRequired, LessonsService } from '../courses/lessons.service.js';
import { AuditService } from '../events/audit.service.js';
import { OutboxService } from '../events/outbox.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';

interface PostRow extends Record<string, unknown> {
  id: string;
  course_id: string;
  lesson_id: string | null;
  parent_id: string | null;
  author_id: string | null;
  title: string | null;
  body: string;
  status: DiscussionPost['status'];
  pinned: boolean;
  locked: boolean;
  accepted: boolean;
  reply_count: number;
  vote_count: number;
  created_at: string;
  edited_at: string | null;
  last_activity_at: string;
  author_name: string | null;
  author_role: Role | null;
  voted: boolean;
  report_count: number;
}

/** Who is reading, and what they may do in this course's discussions. */
interface Reader {
  school: SchoolContext;
  userId: string;
  course: CourseRecord;
  moderator: boolean;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,6})?[+-]\d{2}(:\d{2})?$/;

const iso = (value: string | null) => (value ? new Date(value).toISOString() : null);
const locked = () => new ApiException(HttpStatus.CONFLICT, 'conflict', 'This thread is locked: no new replies.');

/**
 * Course discussions and lesson comments. Readers are the course's editors and its enrolled
 * students; the editors moderate. Every change is announced to whoever is watching the course, and
 * new posts, replies and reports go to the worker for notifications.
 */
@Injectable()
export class DiscussionsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly courses: CoursesService,
    private readonly lessons: LessonsService,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
  ) {}

  // Reading ---------------------------------------------------------------------------------------

  /** A course's threads: pinned first, then by the chosen order. */
  async threads(school: SchoolContext, userId: string, courseSlug: string, query: DiscussionQuery): Promise<DiscussionPage> {
    return this.db.transaction({ userId, schoolId: school.id }, async (tx) => {
      const reader = await this.reader(tx, school, userId, courseSlug);
      const rows = await this.topLevel(tx, reader, sql`p.lesson_id is null`, query);
      return page(rows, query, (row) => this.toPost(row, reader));
    });
  }

  /** A lesson's comments, each with its replies. */
  async comments(school: SchoolContext, userId: string, courseSlug: string, lessonId: string, query: DiscussionQuery): Promise<DiscussionPage<DiscussionThread>> {
    return this.db.transaction({ userId, schoolId: school.id }, async (tx) => {
      const reader = await this.reader(tx, school, userId, courseSlug);
      const lesson = await this.lessonFor(tx, reader, lessonId);
      const rows = await this.topLevel(tx, reader, sql`p.lesson_id = ${lesson.id}`, query);
      const shown = rows.slice(0, query.limit);
      const replies = await this.repliesOf(tx, reader, shown.map((row) => row.id));
      return page(rows, query, (row) => this.toThread(row, replies.get(row.id) ?? [], reader, lesson));
    });
  }

  /** A thread or lesson comment with its replies. Asked for by a reply's id, its thread. */
  async thread(school: SchoolContext, userId: string, courseSlug: string, postId: string): Promise<DiscussionThread> {
    return this.db.transaction({ userId, schoolId: school.id }, async (tx) => {
      const reader = await this.reader(tx, school, userId, courseSlug);
      return this.describeThread(tx, reader, postId);
    });
  }

  // Writing ---------------------------------------------------------------------------------------

  async createThread(school: SchoolContext, userId: string, courseSlug: string, input: NewThreadInput): Promise<DiscussionThread> {
    return this.db.transaction({ userId, schoolId: school.id }, async (tx) => {
      const reader = await this.reader(tx, school, userId, courseSlug);
      const [post] = await tx
        .insert(discussionPosts)
        .values({ schoolId: school.id, courseId: reader.course.id, authorId: userId, title: input.title, body: input.body })
        .returning({ id: discussionPosts.id });
      await this.outbox.add(tx, 'discussion.posted', { postId: post!.id, courseId: reader.course.id, lessonId: null, actorId: userId }, school.id);
      this.announce(reader, null, post!.id, post!.id, 'created');
      return this.describeThread(tx, reader, post!.id);
    });
  }

  async createComment(school: SchoolContext, userId: string, courseSlug: string, lessonId: string, input: NewPostInput): Promise<DiscussionThread> {
    return this.db.transaction({ userId, schoolId: school.id }, async (tx) => {
      const reader = await this.reader(tx, school, userId, courseSlug);
      const lesson = await this.lessonFor(tx, reader, lessonId);
      const [post] = await tx
        .insert(discussionPosts)
        .values({ schoolId: school.id, courseId: reader.course.id, lessonId: lesson.id, authorId: userId, body: input.body })
        .returning({ id: discussionPosts.id });
      await this.outbox.add(tx, 'discussion.posted', { postId: post!.id, courseId: reader.course.id, lessonId: lesson.id, actorId: userId }, school.id);
      this.announce(reader, lesson.id, post!.id, post!.id, 'created');
      return this.describeThread(tx, reader, post!.id);
    });
  }

  async reply(school: SchoolContext, userId: string, courseSlug: string, postId: string, input: NewPostInput): Promise<DiscussionPost> {
    return this.db.transaction({ userId, schoolId: school.id }, async (tx) => {
      const reader = await this.reader(tx, school, userId, courseSlug);
      const parent = await this.postFor(tx, reader, postId, { forUpdate: true });
      if (parent.parentId) throw new ApiException(HttpStatus.CONFLICT, 'conflict', 'Reply to the thread, not to a reply.');
      if (parent.status !== 'visible') throw new ApiException(HttpStatus.CONFLICT, 'conflict', "This post can't take replies.");
      if (parent.locked && !reader.moderator) throw locked();
      if (parent.lessonId) await this.lessonFor(tx, reader, parent.lessonId);
      const [reply] = await tx
        .insert(discussionPosts)
        .values({ schoolId: school.id, courseId: reader.course.id, lessonId: parent.lessonId, parentId: parent.id, authorId: userId, body: input.body })
        .returning({ id: discussionPosts.id });
      await this.recount(tx, parent.id);
      await this.outbox.add(
        tx,
        'discussion.replied',
        { postId: reply!.id, parentId: parent.id, courseId: reader.course.id, lessonId: parent.lessonId, actorId: userId },
        school.id,
      );
      this.announce(reader, parent.lessonId, parent.id, reply!.id, 'created');
      return this.describePost(tx, reader, reply!.id);
    });
  }

  /** The author's own edit. A thread's title can change too. */
  async edit(school: SchoolContext, userId: string, courseSlug: string, postId: string, input: EditPostInput): Promise<DiscussionPost> {
    return this.db.transaction({ userId, schoolId: school.id }, async (tx) => {
      const reader = await this.reader(tx, school, userId, courseSlug);
      const post = await this.postFor(tx, reader, postId, { forUpdate: true });
      if (post.authorId !== userId || post.status === 'deleted') throw forbidden('Only its author can edit a post.');
      if (input.title !== undefined && post.title === null) {
        throw new ApiException(HttpStatus.BAD_REQUEST, 'validation_failed', 'Only threads have titles.', [{ path: 'title', message: 'Only threads have titles' }]);
      }
      await tx
        .update(discussionPosts)
        .set({ body: input.body, ...(input.title !== undefined && { title: input.title }), editedAt: sql`now()` })
        .where(eq(discussionPosts.id, post.id));
      this.announce(reader, post.lessonId, post.parentId ?? post.id, post.id, 'updated');
      return this.describePost(tx, reader, post.id);
    });
  }

  /**
   * Deleting: a post with replies leaves a placeholder (its text is wiped), one without is removed.
   * Authors delete their own; moderators any.
   */
  async remove(school: SchoolContext, userId: string, courseSlug: string, postId: string, ip: string | null): Promise<void> {
    await this.db.transaction({ userId, schoolId: school.id }, async (tx) => {
      const reader = await this.reader(tx, school, userId, courseSlug);
      const post = await this.postFor(tx, reader, postId, { forUpdate: true });
      if (post.authorId !== userId && !reader.moderator) throw forbidden('Only its author or a moderator can delete a post.');
      if (post.status === 'deleted') return;
      const [{ replies } = { replies: 0 }] = await tx
        .select({ replies: sql<number>`count(*)::int` })
        .from(discussionPosts)
        .where(eq(discussionPosts.parentId, post.id));
      if (replies > 0) {
        await tx
          .update(discussionPosts)
          .set({ status: 'deleted', body: '[deleted]', ...(post.title !== null && { title: '[deleted]' }), pinned: false })
          .where(eq(discussionPosts.id, post.id));
      } else {
        await tx.delete(discussionPosts).where(eq(discussionPosts.id, post.id));
      }
      if (post.parentId) {
        await this.recount(tx, post.parentId);
        // A deleted thread whose last reply just went goes too.
        await tx.execute(sql`delete from discussion_posts where id = ${post.parentId} and status = 'deleted'
          and not exists (select 1 from discussion_posts r where r.parent_id = ${post.parentId})`);
      }
      if (post.authorId !== userId) {
        await this.audit.record(tx, { action: 'discussion.deleted', actorId: userId, schoolId: school.id, targetType: 'discussion_post', targetId: post.id, ip });
      }
      this.announce(reader, post.lessonId, post.parentId ?? post.id, post.id, 'removed');
    });
  }

  /** Marks a post helpful, or not. Not one's own. */
  async vote(school: SchoolContext, userId: string, courseSlug: string, postId: string, helpful: boolean): Promise<{ voteCount: number; voted: boolean }> {
    return this.db.transaction({ userId, schoolId: school.id }, async (tx) => {
      const reader = await this.reader(tx, school, userId, courseSlug);
      const post = await this.postFor(tx, reader, postId, { forUpdate: true });
      if (post.status !== 'visible') throw new ApiException(HttpStatus.CONFLICT, 'conflict', "This post can't be voted on.");
      if (post.authorId === userId) throw new ApiException(HttpStatus.CONFLICT, 'conflict', "You can't mark your own post helpful.");
      if (helpful) {
        await tx.insert(discussionVotes).values({ schoolId: school.id, postId: post.id, userId }).onConflictDoNothing();
      } else {
        await tx.delete(discussionVotes).where(and(eq(discussionVotes.postId, post.id), eq(discussionVotes.userId, userId)));
      }
      const [updated] = await tx
        .update(discussionPosts)
        .set({ voteCount: sql`(select count(*)::int from discussion_votes v where v.post_id = ${post.id})` })
        .where(eq(discussionPosts.id, post.id))
        .returning({ voteCount: discussionPosts.voteCount });
      this.announce(reader, post.lessonId, post.parentId ?? post.id, post.id, 'updated');
      return { voteCount: updated!.voteCount, voted: helpful };
    });
  }

  // Moderation ------------------------------------------------------------------------------------

  async moderate(school: SchoolContext, userId: string, courseSlug: string, postId: string, input: ModeratePostInput, ip: string | null): Promise<DiscussionPost> {
    return this.db.transaction({ userId, schoolId: school.id }, async (tx) => {
      const reader = await this.reader(tx, school, userId, courseSlug);
      if (!reader.moderator) throw forbidden("Only the course's editors moderate its discussions.");
      const post = await this.postFor(tx, reader, postId, { forUpdate: true });
      if (post.status === 'deleted') throw new ApiException(HttpStatus.CONFLICT, 'conflict', 'This post was deleted.');
      const topLevel = post.parentId === null;
      if (!topLevel && (input.pinned !== undefined || input.locked !== undefined)) {
        throw new ApiException(HttpStatus.CONFLICT, 'conflict', 'Only threads and lesson comments can be pinned or locked.');
      }
      if (topLevel && input.accepted !== undefined) throw new ApiException(HttpStatus.CONFLICT, 'conflict', 'Only a reply can be the answer.');

      const changes: Partial<typeof discussionPosts.$inferInsert> = {};
      if (input.pinned !== undefined) changes.pinned = input.pinned;
      if (input.locked !== undefined) changes.locked = input.locked;
      if (input.hidden !== undefined) changes.status = input.hidden ? 'hidden' : 'visible';
      if (input.accepted !== undefined) {
        if (input.accepted && (input.hidden ?? post.status === 'hidden')) throw new ApiException(HttpStatus.CONFLICT, 'conflict', "A hidden reply can't be the answer.");
        changes.accepted = input.accepted;
        // One answer per thread.
        if (input.accepted) await tx.update(discussionPosts).set({ accepted: false }).where(and(eq(discussionPosts.parentId, post.parentId!), eq(discussionPosts.accepted, true)));
      }
      if (input.hidden) changes.accepted = false;
      await tx
        .update(discussionPosts)
        .set({ ...changes, moderatedBy: userId, moderatedAt: sql`now()` })
        .where(eq(discussionPosts.id, post.id));
      if (input.hidden !== undefined) {
        if (input.hidden) await this.resolveReportsOf(tx, post.id, userId, 'hidden');
        if (post.parentId) await this.recount(tx, post.parentId);
      }
      await this.audit.record(tx, {
        action: 'discussion.moderated',
        actorId: userId,
        schoolId: school.id,
        targetType: 'discussion_post',
        targetId: post.id,
        ip,
        data: { ...input },
      });
      this.announce(reader, post.lessonId, post.parentId ?? post.id, post.id, 'updated');
      return this.describePost(tx, reader, post.id);
    });
  }

  /** Flags a post for the course's editors. Once per person and post, never one's own. */
  async report(school: SchoolContext, userId: string, courseSlug: string, postId: string, input: ReportPostInput): Promise<void> {
    await this.db.transaction({ userId, schoolId: school.id }, async (tx) => {
      const reader = await this.reader(tx, school, userId, courseSlug);
      const post = await this.postFor(tx, reader, postId);
      if (post.status !== 'visible') throw new ApiException(HttpStatus.CONFLICT, 'conflict', 'This post is already out of view.');
      if (post.authorId === userId) throw new ApiException(HttpStatus.CONFLICT, 'conflict', "You can't report your own post.");
      const [report] = await tx
        .insert(discussionReports)
        .values({ schoolId: school.id, courseId: reader.course.id, postId: post.id, reporterId: userId, reason: input.reason, note: input.note })
        .onConflictDoNothing()
        .returning({ id: discussionReports.id });
      if (!report) throw new ApiException(HttpStatus.CONFLICT, 'conflict', "You've already reported this post.");
      await this.outbox.add(tx, 'discussion.reported', { reportId: report.id, postId: post.id, courseId: reader.course.id, actorId: userId }, school.id);
    });
  }

  /** Open reports, oldest first, for the course's editors. */
  async reports(school: SchoolContext, userId: string, courseSlug: string): Promise<DiscussionReport[]> {
    return this.db.transaction({ userId, schoolId: school.id }, async (tx) => {
      const reader = await this.reader(tx, school, userId, courseSlug);
      if (!reader.moderator) throw forbidden("Only the course's editors see its reports.");
      const rows = await tx.execute<{
        id: string;
        post_id: string;
        reason: DiscussionReport['reason'];
        note: string;
        reporter_id: string | null;
        reporter_name: string | null;
        created_at: string;
        thread_id: string;
        thread_title: string | null;
        lesson_id: string | null;
        lesson_title: string | null;
      }>(sql`
        select r.id, r.post_id, r.reason, r.note, r.reporter_id, u.name as reporter_name, r.created_at::text,
               coalesce(p.parent_id, p.id) as thread_id, coalesce(t.title, p.title) as thread_title,
               p.lesson_id, l.title as lesson_title
        from discussion_reports r
        join discussion_posts p on p.id = r.post_id
        left join discussion_posts t on t.id = p.parent_id
        left join lessons l on l.id = p.lesson_id
        left join users u on u.id = r.reporter_id
        where r.course_id = ${reader.course.id} and r.resolved_at is null
        order by r.created_at, r.id
        limit 200`);
      const posts = new Map((await this.selectPosts(tx, reader, sql`p.id = any(${pgUuids(rows.map((row) => row.post_id))})`)).map((row) => [row.id, row]));
      return rows.flatMap((row) => {
        const post = posts.get(row.post_id);
        if (!post) return [];
        return [
          {
            id: row.id,
            reason: row.reason,
            note: row.note,
            reporter: row.reporter_id ? { id: row.reporter_id, name: row.reporter_name ?? '' } : null,
            createdAt: iso(row.created_at)!,
            post: this.toPost(post, reader),
            context: { threadId: row.thread_id, threadTitle: row.thread_title, lessonId: row.lesson_id, lessonTitle: row.lesson_title },
          },
        ];
      });
    });
  }

  /** Hides the reported post (settling every report of it), or dismisses this report. */
  async resolve(school: SchoolContext, userId: string, courseSlug: string, reportId: string, input: ResolveReportInput, ip: string | null): Promise<void> {
    await this.db.transaction({ userId, schoolId: school.id }, async (tx) => {
      const reader = await this.reader(tx, school, userId, courseSlug);
      if (!reader.moderator) throw forbidden("Only the course's editors deal with reports.");
      const [report] = await tx
        .select()
        .from(discussionReports)
        .where(and(eq(discussionReports.id, reportId), eq(discussionReports.courseId, reader.course.id)))
        .for('update');
      if (!report) throw notFound('This report');
      if (report.resolvedAt) throw new ApiException(HttpStatus.CONFLICT, 'conflict', 'This report was already dealt with.');
      if (input.action === 'hide') {
        const [post] = await tx
          .update(discussionPosts)
          .set({ status: 'hidden', accepted: false, moderatedBy: userId, moderatedAt: sql`now()` })
          .where(and(eq(discussionPosts.id, report.postId), eq(discussionPosts.status, 'visible')))
          .returning({ id: discussionPosts.id, parentId: discussionPosts.parentId, lessonId: discussionPosts.lessonId });
        await this.resolveReportsOf(tx, report.postId, userId, 'hidden');
        if (post?.parentId) await this.recount(tx, post.parentId);
        if (post) this.announce(reader, post.lessonId, post.parentId ?? post.id, post.id, 'updated');
      } else {
        await tx
          .update(discussionReports)
          .set({ resolvedAt: sql`now()`, resolvedBy: userId, resolution: 'dismissed' })
          .where(eq(discussionReports.id, report.id));
      }
      await this.audit.record(tx, {
        action: input.action === 'hide' ? 'discussion.report_upheld' : 'discussion.report_dismissed',
        actorId: userId,
        schoolId: school.id,
        targetType: 'discussion_post',
        targetId: report.postId,
        ip,
        data: { reportId: report.id },
      });
    });
  }

  // Helpers ---------------------------------------------------------------------------------------

  /** The course, if this person may read its discussions: its editors, and enrolled students. */
  private async reader(tx: Tx, school: SchoolContext, userId: string, courseSlug: string): Promise<Reader> {
    const course = await this.courses.findVisible(tx, school, userId, courseSlug);
    const moderator = canEditCourse(school, userId, course);
    if (!moderator && (course.status !== 'published' || !(await this.lessons.isEnrolled(tx, course.id, userId)))) throw enrollmentRequired('Enroll in this course to take part in its discussions.');
    return { school, userId, course, moderator };
  }

  /** A lesson of the course whose comments this reader may see: published, or they edit it. */
  private async lessonFor(tx: Tx, reader: Reader, lessonId: string) {
    const { lesson } = await this.lessons.find(tx, reader.school, reader.userId, reader.course, lessonId);
    if (lesson.status !== 'published' && !reader.moderator) throw notFound('This lesson');
    return { id: lesson.id, title: lesson.title };
  }

  /** A post of this course this reader can see. Hidden ones only for their author and moderators. */
  private async postFor(tx: Tx, reader: Reader, postId: string, { forUpdate = false } = {}) {
    const query = tx
      .select()
      .from(discussionPosts)
      .where(and(eq(discussionPosts.id, postId), eq(discussionPosts.courseId, reader.course.id)));
    const [post] = forUpdate ? await query.for('update') : await query;
    if (!post || (post.status === 'hidden' && !reader.moderator && post.authorId !== reader.userId)) throw notFound('This post');
    if (post.lessonId) await this.lessonFor(tx, reader, post.lessonId);
    return post;
  }

  private async describePost(tx: Tx, reader: Reader, postId: string): Promise<DiscussionPost> {
    const [row] = await this.selectPosts(tx, reader, sql`p.id = ${postId}`);
    if (!row) throw notFound('This post');
    return this.toPost(row, reader);
  }

  private async describeThread(tx: Tx, reader: Reader, postId: string): Promise<DiscussionThread> {
    const post = await this.postFor(tx, reader, postId);
    const top = post.parentId ? await this.postFor(tx, reader, post.parentId) : post;
    const [row] = await this.selectPosts(tx, reader, sql`p.id = ${top.id}`);
    if (!row) throw notFound('This thread');
    const replies = await this.repliesOf(tx, reader, [top.id]);
    const lesson = top.lessonId ? await this.lessonFor(tx, reader, top.lessonId) : null;
    return this.toThread(row, replies.get(top.id) ?? [], reader, lesson);
  }

  /** Threads or lesson comments, with the viewer's filter, order and page. One more than asked, to tell if there's another page. */
  private async topLevel(tx: Tx, reader: Reader, where: SQL, query: DiscussionQuery): Promise<(PostRow & { k1: string; k2: string })[]> {
    const key = SORT_KEYS[query.sort];
    const filters: SQL[] = [where, sql`p.parent_id is null`, this.visibleTopLevel(reader)];
    if (query.filter === 'unanswered') filters.push(sql`not exists (select 1 from discussion_posts r where r.parent_id = p.id and r.accepted)`);
    if (query.filter === 'mine') {
      filters.push(sql`(p.author_id = ${reader.userId} or exists (select 1 from discussion_posts r where r.parent_id = p.id and r.author_id = ${reader.userId}))`);
    }
    if (query.cursor) {
      const [pinned, k1, k2, id] = decodeCursor(query.cursor, 4);
      if (!['true', 'false'].includes(pinned!) || !UUID.test(id!) || !key.check(k1!, k2!)) throw badCursor();
      filters.push(sql`(p.pinned, ${key.k1}, ${key.k2}, p.id) < (${pinned === 'true'}::boolean, ${key.cast(k1!, 1)}, ${key.cast(k2!, 2)}, ${id}::uuid)`);
    }
    return (await this.selectPosts(tx, reader, sql.join(filters, sql` and `), {
      extra: sql`, (${key.k1})::text as k1, (${key.k2})::text as k2`,
      order: sql`p.pinned desc, ${key.k1} desc, ${key.k2} desc, p.id desc`,
      limit: query.limit + 1,
    })) as (PostRow & { k1: string; k2: string })[];
  }

  /** Which top-level posts this reader sees: visible ones, hidden ones they may see, and deleted ones that still have replies. */
  private visibleTopLevel(reader: Reader) {
    return sql`(p.status = 'visible' or (p.status = 'hidden' and (${reader.moderator} or p.author_id = ${reader.userId})) or (p.status = 'deleted' and exists (select 1 from discussion_posts r where r.parent_id = p.id)))`;
  }

  private async repliesOf(tx: Tx, reader: Reader, parentIds: string[]): Promise<Map<string, PostRow[]>> {
    const grouped = new Map<string, PostRow[]>();
    if (!parentIds.length) return grouped;
    const rows = await this.selectPosts(tx, reader, sql`p.parent_id = any(${pgUuids(parentIds)})`, { order: sql`p.created_at, p.id` });
    for (const row of rows) {
      const list = grouped.get(row.parent_id!) ?? [];
      list.push(row);
      grouped.set(row.parent_id!, list);
    }
    return grouped;
  }

  private async selectPosts(tx: Tx, reader: Reader, where: SQL, options: { extra?: SQL; order?: SQL; limit?: number } = {}): Promise<PostRow[]> {
    return tx.execute<PostRow>(sql`
      select p.id, p.course_id, p.lesson_id, p.parent_id, p.author_id, p.title, p.body, p.status, p.pinned, p.locked, p.accepted,
             p.reply_count, p.vote_count, p.created_at::text, p.edited_at::text, p.last_activity_at::text,
             u.name as author_name, m.role as author_role,
             exists (select 1 from discussion_votes v where v.post_id = p.id and v.user_id = ${reader.userId}) as voted,
             (select count(*)::int from discussion_reports r where r.post_id = p.id and r.resolved_at is null) as report_count
             ${options.extra ?? sql``}
      from discussion_posts p
      left join users u on u.id = p.author_id
      left join memberships m on m.school_id = p.school_id and m.user_id = p.author_id
      where p.course_id = ${reader.course.id} and ${where}
      ${options.order ? sql`order by ${options.order}` : sql``}
      ${options.limit ? sql`limit ${options.limit}` : sql``}`);
  }

  private toPost(row: PostRow, reader: Reader): DiscussionPost {
    const mine = row.author_id === reader.userId;
    const deleted = row.status === 'deleted';
    const shown = row.status === 'visible' || (row.status === 'hidden' && (mine || reader.moderator));
    return {
      id: row.id,
      courseId: row.course_id,
      lessonId: row.lesson_id,
      parentId: row.parent_id,
      title: deleted ? null : row.title,
      body: shown ? row.body : '',
      author: deleted || !row.author_id ? null : this.author(row, reader.course),
      status: row.status,
      pinned: row.pinned,
      locked: row.locked,
      accepted: row.accepted,
      replyCount: row.reply_count,
      voteCount: row.vote_count,
      voted: row.voted,
      createdAt: iso(row.created_at)!,
      editedAt: iso(row.edited_at),
      lastActivityAt: iso(row.last_activity_at)!,
      mine: mine && !deleted,
      canModerate: reader.moderator,
      reportCount: reader.moderator ? row.report_count : 0,
    };
  }

  private toThread(row: PostRow, replies: PostRow[], reader: Reader, lesson: { id: string; title: string } | null): DiscussionThread {
    return {
      ...this.toPost(row, reader),
      replies: replies.map((reply) => this.toPost(reply, reader)),
      answered: replies.some((reply) => reply.accepted && reply.status === 'visible'),
      lesson,
    };
  }

  private author(row: PostRow, course: CourseRecord): DiscussionAuthor {
    const role = row.author_role;
    const instructor = role !== null && (ROLE_RANK[role] >= ROLE_RANK.admin || (role === 'instructor' && course.createdBy === row.author_id));
    return { id: row.author_id!, name: row.author_name ?? '', role, instructor };
  }

  /** Recounts a thread's visible replies and touches its activity. */
  private async recount(tx: Tx, parentId: string) {
    await tx.execute(sql`
      update discussion_posts set
        reply_count = (select count(*)::int from discussion_posts r where r.parent_id = ${parentId} and r.status = 'visible'),
        last_activity_at = greatest(created_at, coalesce((select max(r.created_at) from discussion_posts r where r.parent_id = ${parentId} and r.status = 'visible'), created_at))
      where id = ${parentId}`);
  }

  private async resolveReportsOf(tx: Tx, postId: string, userId: string, resolution: 'hidden' | 'dismissed') {
    await tx
      .update(discussionReports)
      .set({ resolvedAt: sql`now()`, resolvedBy: userId, resolution })
      .where(and(eq(discussionReports.postId, postId), isNull(discussionReports.resolvedAt)));
  }

  private announce(reader: Reader, lessonId: string | null, threadId: string, postId: string, change: 'created' | 'updated' | 'removed') {
    this.realtime.emitToCourse(reader.course.id, 'discussion:changed', { courseId: reader.course.id, lessonId, threadId, postId, change });
  }
}

/** Each order's two sort keys after "pinned first", as SQL, and how to read them back from a cursor. */
const SORT_KEYS: Record<DiscussionQuery['sort'], { k1: SQL; k2: SQL; check: (k1: string, k2: string) => boolean; cast: (value: string, which: 1 | 2) => SQL }> = {
  activity: {
    k1: sql`p.last_activity_at`,
    k2: sql`p.created_at`,
    check: (k1, k2) => TIMESTAMP.test(k1) && TIMESTAMP.test(k2),
    cast: (value) => sql`${value}::timestamptz`,
  },
  new: {
    k1: sql`p.created_at`,
    k2: sql`p.created_at`,
    check: (k1, k2) => TIMESTAMP.test(k1) && TIMESTAMP.test(k2),
    cast: (value) => sql`${value}::timestamptz`,
  },
  top: {
    k1: sql`p.vote_count`,
    k2: sql`p.created_at`,
    check: (k1, k2) => /^\d{1,9}$/.test(k1) && TIMESTAMP.test(k2),
    cast: (value, which) => (which === 1 ? sql`${value}::int` : sql`${value}::timestamptz`),
  },
};

function page<Row extends PostRow & { k1?: string; k2?: string }, T>(rows: Row[], query: DiscussionQuery, map: (row: Row) => T): DiscussionPage<T> {
  const items = rows.slice(0, query.limit);
  const last = items.at(-1);
  const more = rows.length > query.limit && last;
  return {
    items: items.map(map),
    nextCursor: more ? encodeCursor([String(last.pinned), last.k1!, last.k2!, last.id]) : null,
  };
}

/** A uuid[] parameter. */
const pgUuids = (ids: string[]) => sql`${`{${ids.join(',')}}`}::uuid[]`;
