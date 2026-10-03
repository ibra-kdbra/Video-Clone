import { Inject, Injectable, Logger } from '@nestjs/common';
import { type NotificationData, type NotificationType, notificationSettings } from '@grand/contracts';
import { setTimeout as sleep } from 'node:timers/promises';
import { WORKER_CONFIG, type WorkerConfig } from '../config.js';
import { Connections } from '../connections.js';
import { notificationEmail } from '../mail/templates.js';
import { MailerService } from '../mail/mailer.service.js';
import { RealtimeEmitter } from '../realtime.js';

interface Notice {
  schoolId: string;
  recipients: string[];
  type: NotificationType;
  data: NotificationData;
  /** Names the event, so handling it twice notifies once. */
  dedupeKey: string;
}

interface CourseContext {
  schoolSlug: string;
  schoolName: string;
  courseId: string;
  courseSlug: string;
  courseTitle: string;
  courseSummary: string;
  courseStatus: string;
  createdBy: string | null;
}

/**
 * Turns events into notifications: works out who should hear about each one, writes it for those
 * who want it in the app (and tells their open devices at once), and emails those who asked for
 * email. Text is written here, so the app and the email say the same thing.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly connections: Connections,
    private readonly realtime: RealtimeEmitter,
    private readonly mailer: MailerService,
    @Inject(WORKER_CONFIG) private readonly config: WorkerConfig,
  ) {}

  // Events ----------------------------------------------------------------------------------------

  /** A course went live: every member of the school but its publisher hears about it. */
  async coursePublished(payload: { courseId: string; schoolId: string; actorId?: string }, eventId: number) {
    const course = await this.course(payload.schoolId, payload.courseId);
    if (!course || course.courseStatus !== 'published') return;
    const members = await this.connections.withSchool(payload.schoolId, (tx) => tx<{ user_id: string }[]>`select user_id from memberships where school_id = ${payload.schoolId}`);
    await this.notify({
      schoolId: payload.schoolId,
      recipients: members.map((row) => row.user_id).filter((id) => id !== payload.actorId),
      type: 'course.published',
      data: {
        title: `New course: ${course.courseTitle}`,
        body: course.courseSummary || `${course.schoolName} has a new course.`,
        path: `/s/${course.schoolSlug}/c/${course.courseSlug}`,
        schoolName: course.schoolName,
      },
      dedupeKey: `outbox:${eventId}`,
    });
  }

  /** A new lesson in a live course: its enrolled students hear about it. */
  async lessonPublished(payload: { lessonId: string; courseId: string; actorId?: string }, schoolId: string, eventId: number) {
    const course = await this.course(schoolId, payload.courseId);
    const lesson = await this.lesson(schoolId, payload.lessonId);
    if (!course || !lesson || course.courseStatus !== 'published' || lesson.status !== 'published') return;
    await this.notify({
      schoolId,
      recipients: (await this.enrolled(schoolId, course.courseId)).filter((id) => id !== payload.actorId),
      type: 'lesson.published',
      data: {
        title: `New in ${course.courseTitle}: ${lesson.title}`,
        body: lesson.summary,
        path: `/s/${course.schoolSlug}/c/${course.courseSlug}/l/${lesson.id}`,
        schoolName: course.schoolName,
      },
      dedupeKey: `outbox:${eventId}`,
    });
  }

  /**
   * A student handed in an assignment: the course's author hears about it, or, if they're no longer
   * on its staff, the school's admins and owner.
   */
  async assignmentSubmitted(payload: { submissionId: string; lessonId: string; courseId: string; studentId: string }, schoolId: string, eventId: number) {
    const course = await this.course(schoolId, payload.courseId);
    const lesson = await this.lesson(schoolId, payload.lessonId);
    if (!course || !lesson) return;
    const student = await this.name(payload.studentId);
    await this.notify({
      schoolId,
      recipients: (await this.staffFor(schoolId, course)).filter((id) => id !== payload.studentId),
      type: 'assignment.submitted',
      data: {
        title: `${student} handed in ${lesson.title}`,
        body: course.courseTitle,
        path: `/s/${course.schoolSlug}/c/${course.courseSlug}/l/${lesson.id}/submissions/${payload.submissionId}`,
        schoolName: course.schoolName,
      },
      dedupeKey: `outbox:${eventId}`,
    });
  }

  /** A submission was graded, or returned for another try: its student hears about it. */
  async assignmentGraded(
    payload: { submissionId: string; lessonId: string; courseId: string; studentId: string; status: 'graded' | 'returned'; grade: number | null; maxPoints: number },
    schoolId: string,
    eventId: number,
  ) {
    const course = await this.course(schoolId, payload.courseId);
    const lesson = await this.lesson(schoolId, payload.lessonId);
    if (!course || !lesson) return;
    const graded = payload.status === 'graded';
    await this.notify({
      schoolId,
      recipients: [payload.studentId],
      type: 'assignment.graded',
      data: {
        title: graded ? `${lesson.title} was graded: ${formatPoints(payload.grade ?? 0)}/${payload.maxPoints}` : `${lesson.title} was returned to you`,
        body: graded ? course.courseTitle : `Have a look at the feedback in ${course.courseTitle} and hand it in again.`,
        path: `/s/${course.schoolSlug}/c/${course.courseSlug}/l/${lesson.id}`,
        schoolName: course.schoolName,
      },
      dedupeKey: `outbox:${eventId}`,
    });
  }

  /** An uploaded video is ready, or couldn't be processed: whoever uploaded it hears about it. */
  async videoProcessed({ schoolId, assetId, lessonId, uploadedBy, ready, error }: { schoolId: string; assetId: string; lessonId: string | null; uploadedBy: string | null; ready: boolean; error?: string }) {
    if (!uploadedBy || !lessonId) return;
    const lesson = await this.lesson(schoolId, lessonId);
    const course = lesson ? await this.course(schoolId, lesson.course_id) : null;
    if (!lesson || !course) return;
    await this.notify({
      schoolId,
      recipients: [uploadedBy],
      type: 'video.processed',
      data: {
        title: ready ? `Your video for ${lesson.title} is ready` : `Your video for ${lesson.title} couldn't be processed`,
        body: ready ? course.courseTitle : (error ?? 'Try uploading it again.'),
        path: `/s/${course.schoolSlug}/c/${course.courseSlug}/edit?lesson=${lesson.id}`,
        schoolName: course.schoolName,
      },
      dedupeKey: `media:${assetId}:${ready ? 'ready' : 'failed'}`,
    });
  }

  /** A new course thread or lesson comment: the course's staff hear about it (as for handed-in work). */
  async discussionPosted(payload: { postId: string; courseId: string; lessonId: string | null; actorId: string }, schoolId: string, eventId: number) {
    const course = await this.course(schoolId, payload.courseId);
    const post = await this.post(schoolId, payload.postId);
    if (!course || !post || post.status !== 'visible') return;
    const lesson = post.lesson_id ? await this.lesson(schoolId, post.lesson_id) : null;
    const who = await this.name(payload.actorId);
    await this.notify({
      schoolId,
      recipients: (await this.staffFor(schoolId, course)).filter((id) => id !== payload.actorId),
      type: 'discussion.posted',
      data: {
        title: lesson ? `${who} commented on ${lesson.title}` : `${who} started a thread: ${post.title}`,
        body: excerpt(post.body),
        path: threadPath(course, post.lesson_id, post.id),
        schoolName: course.schoolName,
      },
      dedupeKey: `outbox:${eventId}`,
    });
  }

  /** A reply: the author of the thread or comment it answers hears about it. */
  async discussionReplied(payload: { postId: string; parentId: string; courseId: string; actorId: string }, schoolId: string, eventId: number) {
    const course = await this.course(schoolId, payload.courseId);
    const [reply, parent] = await Promise.all([this.post(schoolId, payload.postId), this.post(schoolId, payload.parentId)]);
    if (!course || !reply || !parent || reply.status !== 'visible' || !parent.author_id || parent.status === 'deleted') return;
    const lesson = parent.lesson_id ? await this.lesson(schoolId, parent.lesson_id) : null;
    const who = await this.name(payload.actorId);
    await this.notify({
      schoolId,
      recipients: [parent.author_id].filter((id) => id !== payload.actorId),
      type: 'discussion.reply',
      data: {
        title: lesson ? `${who} replied to your comment on ${lesson.title}` : `${who} replied in “${parent.title}”`,
        body: excerpt(reply.body),
        path: threadPath(course, parent.lesson_id, parent.id),
        schoolName: course.schoolName,
      },
      dedupeKey: `outbox:${eventId}`,
    });
  }

  /** A post was reported: the course's staff hear about it, to look at the moderation queue. */
  async discussionReported(payload: { reportId: string; postId: string; courseId: string; actorId: string }, schoolId: string, eventId: number) {
    const course = await this.course(schoolId, payload.courseId);
    const [report] = await this.connections.withSchool(schoolId, (tx) => tx<{ reason: string; resolved_at: Date | null }[]>`
      select reason::text, resolved_at from discussion_reports where id = ${payload.reportId}`);
    if (!course || !report || report.resolved_at) return;
    await this.notify({
      schoolId,
      recipients: (await this.staffFor(schoolId, course)).filter((id) => id !== payload.actorId),
      type: 'discussion.reported',
      data: {
        title: `A post was reported in ${course.courseTitle}`,
        body: `Reason: ${REPORT_REASONS[report.reason] ?? report.reason}. Have a look in the moderation queue.`,
        path: `/s/${course.schoolSlug}/c/${course.courseSlug}/discussions/reports`,
        schoolName: course.schoolName,
      },
      dedupeKey: `outbox:${eventId}`,
    });
  }

  /** A class was scheduled: the course's students hear about it. */
  async liveScheduled(payload: { sessionId: string; courseId: string; actorId?: string }, schoolId: string, eventId: number) {
    const context = await this.liveContext(schoolId, payload.sessionId);
    if (!context || context.session.status !== 'scheduled') return;
    await this.notify({
      schoolId,
      recipients: (await this.enrolled(schoolId, context.course.courseId)).filter((id) => id !== payload.actorId),
      type: 'live.scheduled',
      data: {
        title: `Live class: ${context.session.title}`,
        body: `${context.course.courseTitle} · ${formatWhen(context.session.starts_at)}`,
        path: livePath(context.course, context.session.id),
        schoolName: context.course.schoolName,
      },
      dedupeKey: `outbox:${eventId}`,
    });
  }

  /** A class started: the course's students hear about it, to come in. */
  async liveStarted(payload: { sessionId: string; courseId: string; actorId?: string }, schoolId: string, eventId: number) {
    const context = await this.liveContext(schoolId, payload.sessionId);
    if (!context || context.session.status !== 'live') return;
    await this.notify({
      schoolId,
      recipients: (await this.enrolled(schoolId, context.course.courseId)).filter((id) => id !== payload.actorId),
      type: 'live.started',
      data: {
        title: `Live now: ${context.session.title}`,
        body: `${context.course.courseTitle}. Come in!`,
        path: livePath(context.course, context.session.id),
        schoolName: context.course.schoolName,
      },
      dedupeKey: `outbox:${eventId}`,
    });
  }

  /** Shortly before a class: its students and its host hear it's starting soon. */
  async liveReminder(schoolId: string, sessionId: string) {
    const context = await this.liveContext(schoolId, sessionId);
    if (!context || context.session.status !== 'scheduled') return;
    const minutes = Math.max(1, Math.round((context.session.starts_at.getTime() - Date.now()) / 60_000));
    const recipients = await this.enrolled(schoolId, context.course.courseId);
    if (context.session.created_by) recipients.push(context.session.created_by);
    await this.notify({
      schoolId,
      recipients,
      type: 'live.reminder',
      data: {
        title: `Starting in ${minutes} minute${minutes === 1 ? '' : 's'}: ${context.session.title}`,
        body: `${context.course.courseTitle}. The waiting room is open.`,
        path: livePath(context.course, context.session.id),
        schoolName: context.course.schoolName,
      },
      dedupeKey: `live-reminder:${sessionId}`,
    });
  }

  // Delivery --------------------------------------------------------------------------------------

  /**
   * Writes the notification for recipients who want it in the app and pushes it to their open
   * devices, then emails those who want email. A retried event writes nothing new, and emails
   * only people it couldn't have emailed before (those not notified in the app).
   */
  async notify(notice: Notice): Promise<{ notified: number; emailed: number }> {
    const ids = [...new Set(notice.recipients)];
    if (!ids.length) return { notified: 0, emailed: 0 };
    const people = await this.connections.sql<{ id: string; email: string; name: string; notification_settings: unknown }[]>`
      select id, email, name, notification_settings from users where id = any(${ids}::uuid[])`;
    const wants = new Map(people.map((person) => [person.id, notificationSettings(person.notification_settings)[notice.type]]));

    const inApp = people.filter((person) => wants.get(person.id)!.inApp).map((person) => person.id);
    const written = inApp.length
      ? await this.connections.withSchool(notice.schoolId, (tx) => tx<{ id: string; user_id: string; created_at: Date }[]>`
          select * from app.add_notifications(${inApp}::uuid[], ${notice.type}, ${tx.json(notice.data as never)}, ${notice.dedupeKey})`)
      : [];
    for (const row of written) {
      this.realtime.toUser(row.user_id, 'notification:new', {
        id: row.id,
        type: notice.type,
        schoolId: notice.schoolId,
        data: notice.data,
        createdAt: row.created_at.toISOString(),
        readAt: null,
      });
    }

    const notifiedNow = new Set(written.map((row) => row.user_id));
    const emailTo = people.filter((person) => {
      const choice = wants.get(person.id)!;
      return choice.email && (!choice.inApp || notifiedNow.has(person.id));
    });
    for (const [index, person] of emailTo.entries()) {
      // Paced, to stay within the mail provider's limits on a large school.
      if (index > 0) await sleep(1000 / this.config.MAIL_RATE_PER_SECOND);
      await this.mailer.send(
        notificationEmail({
          to: person.email,
          name: person.name,
          schoolName: notice.data.schoolName,
          title: notice.data.title,
          body: notice.data.body,
          url: `${this.config.PUBLIC_WEB_URL}${notice.data.path}`,
          settingsUrl: `${this.config.PUBLIC_WEB_URL}/account/notifications`,
        }),
      );
    }
    if (written.length || emailTo.length) this.logger.log(`${notice.type}: ${written.length} notified, ${emailTo.length} emailed`);
    return { notified: written.length, emailed: emailTo.length };
  }

  // Lookups ---------------------------------------------------------------------------------------

  private async course(schoolId: string, courseId: string): Promise<CourseContext | null> {
    const [row] = await this.connections.withSchool(schoolId, (tx) => tx<CourseContext[]>`
      select s.slug as "schoolSlug", s.name as "schoolName", c.id as "courseId", c.slug as "courseSlug", c.title as "courseTitle",
             c.summary as "courseSummary", c.status::text as "courseStatus", c.created_by as "createdBy"
      from courses c join schools s on s.id = c.school_id
      where c.id = ${courseId}`);
    return row ?? null;
  }

  private async lesson(schoolId: string, lessonId: string) {
    const [row] = await this.connections.withSchool(schoolId, (tx) => tx<{ id: string; course_id: string; title: string; summary: string; status: string }[]>`
      select id, course_id, title, summary, status::text from lessons where id = ${lessonId}`);
    return row ?? null;
  }

  private async enrolled(schoolId: string, courseId: string): Promise<string[]> {
    const rows = await this.connections.withSchool(schoolId, (tx) => tx<{ user_id: string }[]>`select user_id from enrollments where course_id = ${courseId}`);
    return rows.map((row) => row.user_id);
  }

  private async post(schoolId: string, postId: string) {
    const [row] = await this.connections.withSchool(schoolId, (tx) => tx<{ id: string; lesson_id: string | null; author_id: string | null; title: string | null; body: string; status: string }[]>`
      select id, lesson_id, author_id, title, body, status::text from discussion_posts where id = ${postId}`);
    return row ?? null;
  }

  /** The course's author while they're on its staff, else the school's admins and owner. */
  private async staffFor(schoolId: string, course: CourseContext): Promise<string[]> {
    const staff = await this.connections.withSchool(schoolId, (tx) => tx<{ user_id: string; role: string }[]>`
      select user_id, role::text from memberships where school_id = ${schoolId} and role in ('owner', 'admin', 'instructor')`);
    const author = staff.find((row) => row.user_id === course.createdBy);
    return author ? [author.user_id] : staff.filter((row) => row.role !== 'instructor').map((row) => row.user_id);
  }

  private async liveContext(schoolId: string, sessionId: string) {
    const [session] = await this.connections.withSchool(schoolId, (tx) => tx<{ id: string; course_id: string; title: string; starts_at: Date; status: string; created_by: string | null }[]>`
      select id, course_id, title, starts_at, status::text, created_by from live_sessions where id = ${sessionId}`);
    if (!session) return null;
    const course = await this.course(schoolId, session.course_id);
    return course && course.courseStatus === 'published' ? { session, course } : null;
  }

  private async name(userId: string): Promise<string> {
    const [row] = await this.connections.sql<{ name: string }[]>`select name from users where id = ${userId}`;
    return row?.name ?? 'A student';
  }
}

const formatPoints = (points: number) => (Number.isInteger(points) ? String(points) : points.toFixed(2).replace(/0+$/, ''));

/** A post's Markdown down to its words: a notification shows plain text. */
export const plainText = (markdown: string) =>
  markdown
    .replace(/^\s*(```|~~~)[^\n]*$/gm, ' ') // code fences (the code stays)
    .replace(/^\s{0,3}(#{1,6}|>+|[-*+]|\d+[.)])\s+/gm, '') // headings, quotes, list markers
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1') // images: their alt text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // links: their text
    .replace(/(\*\*|__)(?=\S)(.+?)(?<=\S)\1/g, '$2') // bold
    .replace(/(^|[^\w*])([*_])(?=\S)(.+?)(?<=\S)\2(?![\w*])/g, '$1$3') // italics, not snake_case or 2*3
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/`([^`]+)`/g, '$1');

/** The start of a post, as plain text on one line, for a notification's body. */
export const excerpt = (text: string, max = 140) => {
  const line = plainText(text).replace(/\s+/g, ' ').trim();
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
};

const REPORT_REASONS: Record<string, string> = { spam: 'spam', abuse: 'abusive or harmful', off_topic: 'off topic', other: 'something else' };

/** A class's time in emails and notifications. People are in different time zones, so it's in UTC; the app shows local time. */
export const formatWhen = (date: Date) =>
  `${new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }).format(date)} UTC`;

const threadPath = (course: CourseContext, lessonId: string | null, threadId: string) =>
  lessonId ? `/s/${course.schoolSlug}/c/${course.courseSlug}/l/${lessonId}?comment=${threadId}` : `/s/${course.schoolSlug}/c/${course.courseSlug}/discussions/${threadId}`;

const livePath = (course: CourseContext, sessionId: string) => `/s/${course.schoolSlug}/c/${course.courseSlug}/live/${sessionId}`;
