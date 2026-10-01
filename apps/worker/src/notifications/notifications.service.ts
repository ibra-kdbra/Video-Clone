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
    const staff = await this.connections.withSchool(schoolId, (tx) => tx<{ user_id: string; role: string }[]>`
      select user_id, role::text from memberships where school_id = ${schoolId} and role in ('owner', 'admin', 'instructor')`);
    const author = staff.find((row) => row.user_id === course.createdBy);
    const recipients = author ? [author.user_id] : staff.filter((row) => row.role !== 'instructor').map((row) => row.user_id);
    const student = await this.name(payload.studentId);
    await this.notify({
      schoolId,
      recipients: recipients.filter((id) => id !== payload.studentId),
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

  private async name(userId: string): Promise<string> {
    const [row] = await this.connections.sql<{ name: string }[]>`select name from users where id = ${userId}`;
    return row?.name ?? 'A student';
  }
}

const formatPoints = (points: number) => (Number.isInteger(points) ? String(points) : points.toFixed(2).replace(/0+$/, ''));
