import {
  catalogQuery,
  completeUploadInput,
  courseSlug,
  createCourseInput,
  createLessonInput,
  moduleInput,
  outlineInput,
  startUploadInput,
  updateCourseInput,
  updateLessonInput,
  uploadPartsInput,
  uuid,
} from '@grand/contracts';

import { HttpError, conflict, forbidden, notFound } from '../http.js';
import { randomId } from '../ids.js';
import { canCreateCourses, canEditCourse, canWatchLesson, iso, slugify } from '../logic.js';
import { storedBytes } from '../seed.js';
import { removePosts } from './discussions.js';
import { removeSessions } from './live.js';
import {
  describeCourse,
  describeLesson,
  enrollmentRequired,
  findEditable,
  findLesson,
  findVisible,
  isEnrolled,
  outline,
  removeLessonData,
  summaryFields,
  toLessonSummary,
} from './shared.js';

/**
 * Courses, modules, lessons, enrollment, playback and storage (apps/api/src/courses). Uploading
 * videos is turned off in the demo; lessons can embed a video from another platform instead.
 */

export const UPLOADS_OFF = 'Uploading videos is turned off in the demo. Embed a YouTube, Dailymotion or Twitch video instead.';
const MAX_UPLOAD_BYTES = 2 * 1024 ** 3;

const slugTaken = () => new HttpError(409, 'slug_taken', 'Another course in this school uses this address.', [{ path: 'slug', message: 'This address is taken' }]);

const course = { courseSlug };
const lesson = { courseSlug, lessonId: uuid };

/** `base`, or `base-2`, `base-3`… whichever this school doesn't use yet. */
function freeSlug(db, schoolId, base) {
  const stem = base.length >= 3 ? base.slice(0, 55) : `${base}-course`.slice(0, 55);
  const taken = new Set(db.filter('courses', (row) => row.schoolId === schoolId).map((row) => row.slug));
  if (!taken.has(stem)) return stem;
  for (let suffix = 2; ; suffix++) if (!taken.has(`${stem}-${suffix}`)) return `${stem}-${suffix}`;
}

/** Frees the storage that uploaded videos and handed-in files held. */
export function freeStorage(db, schoolId, bytes) {
  if (bytes > 0) db.update('storage', schoolId, (row) => ({ usedBytes: Math.max(0, row.usedBytes - bytes) }));
}

const lessonBytes = (db, lessons) => {
  const lessonIds = new Set(lessons.map((row) => row.id));
  const submissions = new Set(db.filter('submissions', (row) => lessonIds.has(row.lessonId)).map((row) => row.id));
  return (
    lessons.reduce((sum, row) => sum + (row.mediaKey && row.durationSeconds ? storedBytes(row.durationSeconds) : 0), 0) +
    db.filter('files', (row) => submissions.has(row.submissionId) && row.uploaded).reduce((sum, row) => sum + row.sizeBytes, 0)
  );
};

export function register(router, server) {
  // The catalog ------------------------------------------------------------------------------------

  router.add('GET', '/schools/:slug/courses', { school: 'student', query: catalogQuery }, (ctx) => {
    const { db, school, auth, query } = ctx;
    const visible = (row) =>
      school.role === 'owner' || school.role === 'admin'
        ? true
        : school.role === 'instructor'
          ? row.status === 'published' || row.createdBy === auth.userId
          : row.status === 'published';
    const rows = db
      .filter('courses', (row) => row.schoolId === school.id && visible(row) && (!query.status || row.status === query.status))
      .filter((row) => query.mine !== 'true' || isEnrolled(db, row.id, auth.userId))
      // Newest published first; drafts (never published) lead, as NULLs do in a descending sort.
      .sort((a, b) => (b.publishedAt ?? Infinity) - (a.publishedAt ?? Infinity) || b.createdAt - a.createdAt)
      .slice(0, 200);
    return rows.map((row) => {
      const editor = canEditCourse(school, auth.userId, row);
      const lessons = db.filter('lessons', (item) => item.courseId === row.id);
      const published = lessons.filter((item) => item.status === 'published');
      const publishedIds = new Set(published.map((item) => item.id));
      const enrolled = isEnrolled(db, row.id, auth.userId);
      const mine = db.filter('progress', (item) => item.courseId === row.id && item.userId === auth.userId && publishedIds.has(item.lessonId));
      const completed = mine.filter((item) => item.completedAt).length;
      const latest = mine.reduce((best, item) => (!best || item.updatedAt > best.updatedAt ? item : best), null);
      const seconds = (list) => list.reduce((sum, item) => sum + (item.durationSeconds ?? 0), 0);
      return {
        ...summaryFields(row),
        lessonCount: editor ? lessons.length : published.length,
        durationSeconds: editor ? seconds(lessons) : seconds(published),
        enrolled,
        progress: enrolled
          ? {
              completedLessons: completed,
              totalLessons: published.length,
              percent: published.length ? Math.round((completed / published.length) * 100) : 0,
              lastLessonId: latest?.lessonId ?? null,
              lastActivityAt: iso(latest?.updatedAt),
            }
          : null,
      };
    });
  });

  router.add('POST', '/schools/:slug/courses', { school: 'instructor', body: createCourseInput }, (ctx) => {
    const { db, school, auth, body } = ctx;
    if (!canCreateCourses(school)) throw forbidden('Only instructors, admins and the owner can create courses.');
    if (body.slug && db.find('courses', (row) => row.schoolId === school.id && row.slug === body.slug)) throw slugTaken();
    const slug = body.slug ?? freeSlug(db, school.id, slugify(body.title) || 'course');
    const created = db.put('courses', {
      id: randomId(),
      key: null,
      schoolId: school.id,
      slug,
      title: body.title,
      summary: body.summary ?? '',
      description: '',
      status: 'draft',
      createdBy: auth.userId,
      createdAt: ctx.now,
      publishedAt: null,
      cover: null,
    });
    // Every course starts with one module, so lessons have somewhere to go.
    db.put('modules', { id: randomId(), courseId: created.id, title: 'Module 1', position: 0 });
    return describeCourse(ctx, created);
  });

  router.add('GET', '/schools/:slug/courses/:courseSlug', { school: 'student', params: course }, (ctx) => describeCourse(ctx, findVisible(ctx, ctx.params.courseSlug)));

  router.add('PATCH', '/schools/:slug/courses/:courseSlug', { school: 'instructor', params: course, body: updateCourseInput }, (ctx) => {
    const { db, body, school, auth } = ctx;
    const current = findEditable(ctx, ctx.params.courseSlug);
    if (body.slug && body.slug !== current.slug && db.find('courses', (row) => row.schoolId === school.id && row.slug === body.slug)) throw slugTaken();
    const publishing = body.status === 'published' && current.status !== 'published';
    const updated = db.update('courses', current.id, { ...body, ...(publishing && { publishedAt: current.publishedAt ?? ctx.now }) });
    // Published for the first time: everyone in the school hears about it.
    if (publishing && !current.publishedAt) {
      const members = db.filter('memberships', (row) => row.schoolId === school.id).map((row) => row.userId);
      server.notify({
        schoolId: school.id,
        recipients: members.filter((id) => id !== auth.userId),
        type: 'course.published',
        data: { title: `New course: ${updated.title}`, body: updated.summary || `${school.name} has a new course.`, path: `/s/${school.slug}/c/${updated.slug}` },
      });
    }
    return describeCourse(ctx, updated);
  });

  router.add('DELETE', '/schools/:slug/courses/:courseSlug', { school: 'instructor', params: course }, (ctx) => {
    const { db } = ctx;
    const current = findEditable(ctx, ctx.params.courseSlug);
    const lessons = db.filter('lessons', (row) => row.courseId === current.id);
    freeStorage(db, current.schoolId, lessonBytes(db, lessons));
    removeLessonData(
      db,
      lessons.map((row) => row.id),
    );
    db.removeWhere('modules', (row) => row.courseId === current.id);
    db.removeWhere('enrollments', (row) => row.courseId === current.id);
    removePosts(
      db,
      db.filter('posts', (row) => row.courseId === current.id).map((row) => row.id),
    );
    const sessions = db.filter('liveSessions', (row) => row.courseId === current.id);
    for (const session of sessions) server.live.closed(session);
    removeSessions(
      db,
      sessions.map((row) => row.id),
    );
    db.remove('courses', current.id);
  });

  // Modules and the outline ------------------------------------------------------------------------

  router.add('POST', '/schools/:slug/courses/:courseSlug/modules', { school: 'instructor', params: course, body: moduleInput }, (ctx) => {
    const { db } = ctx;
    const current = findEditable(ctx, ctx.params.courseSlug);
    const modules = db.filter('modules', (row) => row.courseId === current.id);
    if (modules.length >= 200) throw new HttpError(403, 'limit_reached', 'A course can have up to 200 modules.');
    db.put('modules', { id: randomId(), courseId: current.id, title: ctx.body.title, position: Math.max(-1, ...modules.map((row) => row.position)) + 1 });
    return describeCourse(ctx, current);
  });

  router.add('PATCH', '/schools/:slug/courses/:courseSlug/modules/:moduleId', { school: 'instructor', params: { courseSlug, moduleId: uuid }, body: moduleInput }, (ctx) => {
    const current = findEditable(ctx, ctx.params.courseSlug);
    const module = ctx.db.get('modules', ctx.params.moduleId);
    if (!module || module.courseId !== current.id) throw notFound('This module');
    ctx.db.update('modules', module.id, { title: ctx.body.title });
    return describeCourse(ctx, current);
  });

  router.add('DELETE', '/schools/:slug/courses/:courseSlug/modules/:moduleId', { school: 'instructor', params: { courseSlug, moduleId: uuid }, status: 200 }, (ctx) => {
    const { db } = ctx;
    const current = findEditable(ctx, ctx.params.courseSlug);
    const modules = db.filter('modules', (row) => row.courseId === current.id);
    if (!modules.some((row) => row.id === ctx.params.moduleId)) throw notFound('This module');
    if (modules.length === 1) throw conflict('A course needs at least one module.');
    const lessons = db.filter('lessons', (row) => row.moduleId === ctx.params.moduleId);
    freeStorage(db, current.schoolId, lessonBytes(db, lessons));
    removeLessonData(
      db,
      lessons.map((row) => row.id),
    );
    db.remove('modules', ctx.params.moduleId);
    return describeCourse(ctx, current);
  });

  router.add('PUT', '/schools/:slug/courses/:courseSlug/outline', { school: 'instructor', params: course, body: outlineInput }, (ctx) => {
    const { db, body } = ctx;
    const current = findEditable(ctx, ctx.params.courseSlug);
    const { modules, lessons } = outline(db, current);
    const sameSet = (listed, actual) => listed.length === actual.length && new Set(listed).size === listed.length && actual.every((id) => listed.includes(id));
    if (
      !sameSet(
        body.modules.map((row) => row.id),
        modules.map((row) => row.id),
      ) ||
      !sameSet(
        body.modules.flatMap((row) => row.lessonIds),
        lessons.map((row) => row.id),
      )
    ) {
      throw conflict('The course changed while you were editing. Reload to see the latest outline.');
    }
    for (const [modulePosition, module] of body.modules.entries()) {
      db.update('modules', module.id, { position: modulePosition });
      for (const [position, lessonId] of module.lessonIds.entries()) db.update('lessons', lessonId, { moduleId: module.id, position });
    }
    return describeCourse(ctx, current);
  });

  // Enrollment -------------------------------------------------------------------------------------

  router.add('POST', '/schools/:slug/courses/:courseSlug/enrollment', { school: 'student', params: course }, (ctx) => {
    const current = findVisible(ctx, ctx.params.courseSlug);
    if (current.status !== 'published') throw conflict("This course isn't open for enrollment yet.");
    const id = `${current.id}:${ctx.auth.userId}`;
    if (!ctx.db.get('enrollments', id)) ctx.db.put('enrollments', { id, schoolId: current.schoolId, courseId: current.id, userId: ctx.auth.userId, createdAt: ctx.now });
  });

  router.add('DELETE', '/schools/:slug/courses/:courseSlug/enrollment', { school: 'student', params: course }, (ctx) => {
    const current = findVisible(ctx, ctx.params.courseSlug);
    ctx.db.remove('enrollments', `${current.id}:${ctx.auth.userId}`);
  });

  router.add('GET', '/schools/:slug/courses/:courseSlug/enrollments', { school: 'instructor', params: course }, (ctx) => {
    const { db } = ctx;
    const current = findEditable(ctx, ctx.params.courseSlug);
    const published = new Set(db.filter('lessons', (row) => row.courseId === current.id && row.status === 'published').map((row) => row.id));
    return db
      .filter('enrollments', (row) => row.courseId === current.id)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 1000)
      .map((enrollment) => {
        const user = db.get('users', enrollment.userId);
        const rows = db.filter('progress', (row) => row.courseId === current.id && row.userId === enrollment.userId && published.has(row.lessonId));
        const completed = rows.filter((row) => row.completedAt).length;
        const last = rows.reduce((best, row) => Math.max(best, row.updatedAt), -Infinity);
        return {
          userId: enrollment.userId,
          name: user.name,
          email: user.email,
          enrolledAt: iso(enrollment.createdAt),
          progress: {
            completedLessons: completed,
            totalLessons: published.size,
            percent: published.size ? Math.round((completed / published.size) * 100) : 0,
            lastActivityAt: rows.length ? iso(last) : null,
          },
        };
      });
  });

  router.add('GET', '/schools/:slug/storage', { school: 'instructor' }, (ctx) => {
    const row = ctx.db.get('storage', ctx.school.id);
    return { quotaBytes: row?.quotaBytes ?? 0, usedBytes: row?.usedBytes ?? 0, reservedBytes: row?.reservedBytes ?? 0, maxUploadBytes: MAX_UPLOAD_BYTES };
  });

  // Lessons ----------------------------------------------------------------------------------------

  router.add('POST', '/schools/:slug/courses/:courseSlug/lessons', { school: 'instructor', params: course, body: createLessonInput }, (ctx) => {
    const { db, body } = ctx;
    const current = findEditable(ctx, ctx.params.courseSlug);
    const module = db.get('modules', body.moduleId);
    if (!module || module.courseId !== current.id) throw notFound('This module');
    if (db.count('lessons', (row) => row.courseId === current.id) >= 500) throw new HttpError(403, 'limit_reached', 'A course can have up to 500 lessons.');
    const siblings = db.filter('lessons', (row) => row.moduleId === module.id);
    const created = db.put('lessons', {
      id: randomId(),
      key: null,
      schoolId: current.schoolId,
      courseId: current.id,
      moduleId: module.id,
      kind: body.kind,
      title: body.title,
      summary: '',
      notes: '',
      status: 'draft',
      isPreview: false,
      position: Math.max(-1, ...siblings.map((row) => row.position)) + 1,
      videoProvider: null,
      videoRef: null,
      mediaKey: null,
      durationSeconds: null,
      publishedAt: null,
      createdAt: ctx.now,
      createdBy: ctx.auth.userId,
    });
    // A quiz or an assignment starts with its default settings.
    if (body.kind === 'quiz') db.put('quizzes', { id: created.id, passPercent: 70, maxAttempts: null, questions: [] });
    if (body.kind === 'assignment') db.put('assignments', { id: created.id, maxPoints: 100, allowText: true, allowFiles: true, dueAt: null });
    return toLessonSummary(created, false);
  });

  router.add('GET', '/schools/:slug/courses/:courseSlug/lessons/:lessonId', { school: 'student', params: lesson }, (ctx) => {
    const current = findVisible(ctx, ctx.params.courseSlug);
    const found = findLesson(ctx, current, ctx.params.lessonId);
    const enrolled = isEnrolled(ctx.db, current.id, ctx.auth.userId);
    if (!canWatchLesson(ctx.school, ctx.auth.userId, current, found, enrolled)) throw enrollmentRequired();
    return describeLesson(ctx, current, found, enrolled);
  });

  router.add('PATCH', '/schools/:slug/courses/:courseSlug/lessons/:lessonId', { school: 'instructor', params: lesson, body: updateLessonInput }, (ctx) => {
    const { db, body, school, auth } = ctx;
    const current = findEditable(ctx, ctx.params.courseSlug);
    const found = findLesson(ctx, current, ctx.params.lessonId);
    const { video, ...fields } = body;
    if (video !== undefined && found.kind !== 'lesson') throw conflict("Quizzes and assignments don't have a video. Put the instructions in the notes.");
    const changes = { ...fields };
    if (body.status === 'published' && found.status !== 'published' && !found.publishedAt) {
      changes.publishedAt = ctx.now;
      // Students already in the course hear about new lessons; publishing the course itself
      // announces the lessons it starts with.
      if (current.status === 'published') {
        const title = fields.title ?? found.title;
        server.notify({
          schoolId: school.id,
          recipients: db
            .filter('enrollments', (row) => row.courseId === current.id)
            .map((row) => row.userId)
            .filter((id) => id !== auth.userId),
          type: 'lesson.published',
          data: { title: `New in ${current.title}: ${title}`, body: fields.summary ?? found.summary, path: `/s/${school.slug}/c/${current.slug}/l/${found.id}` },
        });
      }
    }
    if (video !== undefined) {
      if (found.mediaKey && found.durationSeconds) freeStorage(db, current.schoolId, storedBytes(found.durationSeconds));
      Object.assign(changes, { videoProvider: video?.provider ?? null, videoRef: video?.ref ?? null, mediaKey: null, durationSeconds: video?.durationSeconds ?? null });
    }
    const updated = db.update('lessons', found.id, changes);
    // An editor can be enrolled too: their progress comes back with the lesson.
    return describeLesson(ctx, current, updated, isEnrolled(db, current.id, auth.userId));
  });

  router.add('DELETE', '/schools/:slug/courses/:courseSlug/lessons/:lessonId', { school: 'instructor', params: lesson }, (ctx) => {
    const current = findEditable(ctx, ctx.params.courseSlug);
    const found = findLesson(ctx, current, ctx.params.lessonId);
    freeStorage(ctx.db, current.schoolId, lessonBytes(ctx.db, [found]));
    removeLessonData(ctx.db, [found.id]);
  });

  router.add('GET', '/schools/:slug/courses/:courseSlug/lessons/:lessonId/playback', { school: 'student', params: lesson }, (ctx) => {
    const current = findVisible(ctx, ctx.params.courseSlug);
    const found = findLesson(ctx, current, ctx.params.lessonId);
    const enrolled = isEnrolled(ctx.db, current.id, ctx.auth.userId);
    if (!canWatchLesson(ctx.school, ctx.auth.userId, current, found, enrolled)) throw enrollmentRequired();
    if (found.videoProvider && found.videoProvider !== 'upload' && found.videoRef) return { kind: 'embed', provider: found.videoProvider, ref: found.videoRef };
    if (found.videoProvider !== 'upload' || !found.mediaKey) throw notFound('A video for this lesson');
    // The school's own videos are static files on this site, packaged as the worker packages uploads.
    const base = `/demo/media/${found.mediaKey}`;
    return {
      kind: 'hls',
      manifestUrl: `${base}/master.m3u8`,
      posterUrl: `${base}/poster.jpg`,
      storyboardUrl: `${base}/storyboard.vtt`,
      durationSeconds: found.durationSeconds === null ? null : Math.round(found.durationSeconds),
      expiresAt: iso(ctx.now + 6 * 3_600_000),
    };
  });

  // Uploads: off in the demo -----------------------------------------------------------------------

  const findUpload = (ctx) => {
    const current = findEditable(ctx, ctx.params.courseSlug);
    findLesson(ctx, current, ctx.params.lessonId);
    throw notFound('This upload');
  };
  router.add('POST', '/schools/:slug/courses/:courseSlug/lessons/:lessonId/upload', { school: 'instructor', params: lesson, body: startUploadInput }, () => {
    throw new HttpError(503, 'service_unavailable', UPLOADS_OFF);
  });
  router.add(
    'POST',
    '/schools/:slug/courses/:courseSlug/lessons/:lessonId/upload/:assetId/parts',
    { school: 'instructor', params: { ...lesson, assetId: uuid }, body: uploadPartsInput, status: 200 },
    findUpload,
  );
  router.add(
    'POST',
    '/schools/:slug/courses/:courseSlug/lessons/:lessonId/upload/:assetId/complete',
    { school: 'instructor', params: { ...lesson, assetId: uuid }, body: completeUploadInput, status: 200 },
    findUpload,
  );
  router.add('DELETE', '/schools/:slug/courses/:courseSlug/lessons/:lessonId/upload/:assetId', { school: 'instructor', params: { ...lesson, assetId: uuid } }, findUpload);
}
