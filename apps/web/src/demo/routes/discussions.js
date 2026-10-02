import {
  ROLE_RANK,
  courseSlug,
  discussionQuery,
  editPostInput,
  moderatePostInput,
  newPostInput,
  newThreadInput,
  reportPostInput,
  resolveReportInput,
  uuid,
} from '@grand/contracts';

import { HttpError, badRequest, conflict, forbidden, notFound } from '../http.js';
import { randomId } from '../ids.js';
import { canEditCourse, iso } from '../logic.js';
import { enrollmentRequired, findLesson, findVisible, isEnrolled } from './shared.js';

/**
 * Course threads, lesson comments and replies, and their moderation (apps/api/src/discussions).
 * Readers are the course's editors and its enrolled students; the editors moderate. Every change
 * is announced to whoever watches the course (`discussion:changed`), and new posts, replies and
 * reports notify people as the worker would (core.js).
 */

const course = { courseSlug };
const post = { courseSlug, postId: uuid };
const C = '/schools/:slug/courses/:courseSlug';

const lockedThread = () => conflict('This thread is locked: no new replies.');
const badCursor = () => badRequest('This page link is no longer valid.');

// Pages: the last row's sort values, as the API's cursors (base64url JSON of strings).
const encodeCursor = (values) => btoa(JSON.stringify(values)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function decodeCursor(cursor, length) {
  try {
    const values = JSON.parse(atob(cursor.replace(/-/g, '+').replace(/_/g, '/')));
    if (Array.isArray(values) && values.length === length && values.every((value) => typeof value === 'string' && value.length <= 64)) return values;
  } catch {
    // Falls through.
  }
  throw badCursor();
}

/** Each order's two sort keys after "pinned first" (the API's SORT_KEYS). */
const SORT_KEYS = {
  activity: (row) => [row.lastActivityAt, row.createdAt],
  new: (row) => [row.createdAt, row.createdAt],
  top: (row) => [row.voteCount, row.createdAt],
};

/** Newest (or most helpful) first, pinned before everything: compares [pinned, k1, k2, id], descending. */
function compareKeys(a, b) {
  for (let i = 0; i < a.length; i++) {
    if (a[i] === b[i]) continue;
    return a[i] > b[i] ? -1 : 1;
  }
  return 0;
}

export function register(router, server) {
  // Who's reading ---------------------------------------------------------------------------------

  /** The course, if this person may read its discussions: its editors, and enrolled students. */
  const reader = (ctx) => {
    const found = findVisible(ctx, ctx.params.courseSlug);
    const moderator = canEditCourse(ctx.school, ctx.auth.userId, found);
    if (!moderator && (found.status !== 'published' || !isEnrolled(ctx.db, found.id, ctx.auth.userId))) throw enrollmentRequired('Enroll in this course to take part in its discussions.');
    return { ctx, course: found, userId: ctx.auth.userId, moderator };
  };

  /** A lesson of the course whose comments this reader may see: published, or they edit it. */
  const lessonFor = (r, lessonId) => {
    const lesson = findLesson(r.ctx, r.course, lessonId);
    return { id: lesson.id, title: lesson.title };
  };

  /** A post of this course this reader can see. Hidden ones only for their author and moderators. */
  const postFor = (r, postId) => {
    const row = r.ctx.db.get('posts', postId);
    if (!row || row.courseId !== r.course.id || (row.status === 'hidden' && !r.moderator && row.authorId !== r.userId)) throw notFound('This post');
    if (row.lessonId) lessonFor(r, row.lessonId);
    return row;
  };

  // Views -----------------------------------------------------------------------------------------

  const authorOf = (r, row) => {
    const user = r.ctx.db.get('users', row.authorId);
    const membership = r.ctx.db.get('memberships', `${r.course.schoolId}:${row.authorId}`);
    const role = membership?.role ?? null;
    const instructor = role !== null && (ROLE_RANK[role] >= ROLE_RANK.admin || (role === 'instructor' && r.course.createdBy === row.authorId));
    return { id: row.authorId, name: user?.name ?? '', role, instructor };
  };

  const toPost = (r, row) => {
    const { db } = r.ctx;
    const mine = row.authorId === r.userId;
    const deleted = row.status === 'deleted';
    const shown = row.status === 'visible' || (row.status === 'hidden' && (mine || r.moderator));
    return {
      id: row.id,
      courseId: row.courseId,
      lessonId: row.lessonId,
      parentId: row.parentId,
      title: deleted ? null : row.title,
      body: shown ? row.body : '',
      author: deleted || !row.authorId ? null : authorOf(r, row),
      status: row.status,
      pinned: row.pinned,
      locked: row.locked,
      accepted: row.accepted,
      replyCount: row.replyCount,
      voteCount: row.voteCount,
      voted: Boolean(db.get('votes', `${row.id}:${r.userId}`)),
      createdAt: iso(row.createdAt),
      editedAt: iso(row.editedAt),
      lastActivityAt: iso(row.lastActivityAt),
      mine: mine && !deleted,
      canModerate: r.moderator,
      reportCount: r.moderator ? db.count('reports', (report) => report.postId === row.id && !report.resolvedAt) : 0,
      // The viewer has reported it (settled or not), so they can't again.
      reported: Boolean(db.find('reports', (report) => report.postId === row.id && report.reporterId === r.userId)),
      // A thread or comment with a visible reply accepted as the answer; false for replies.
      answered: row.parentId === null && Boolean(db.find('posts', (reply) => reply.parentId === row.id && reply.accepted && reply.status === 'visible')),
    };
  };

  const repliesOf = (db, parentId) => db.filter('posts', (row) => row.parentId === parentId).sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1));

  const toThread = (r, row, lesson) => ({
    ...toPost(r, row),
    replies: repliesOf(r.ctx.db, row.id).map((reply) => toPost(r, reply)),
    lesson,
  });

  /** A thread or lesson comment with its replies. Asked for by a reply's id, its thread. */
  const describeThread = (r, postId) => {
    const found = postFor(r, postId);
    const top = found.parentId ? postFor(r, found.parentId) : found;
    return toThread(r, top, top.lessonId ? lessonFor(r, top.lessonId) : null);
  };

  /** Threads or lesson comments with the viewer's filter, order and page (the API's topLevel). */
  const topLevel = (r, lessonId, query) => {
    const { db } = r.ctx;
    const keyOf = SORT_KEYS[query.sort];
    const tuple = (row) => [row.pinned ? 1 : 0, ...keyOf(row), row.id];
    let after = null;
    if (query.cursor) {
      const [pinned, k1, k2, id] = decodeCursor(query.cursor, 4);
      const number = (value) => (/^-?\d{1,15}$/.test(value) ? Number(value) : NaN);
      if (!['true', 'false'].includes(pinned) || !/^[0-9a-f-]{36}$/.test(id) || Number.isNaN(number(k1)) || Number.isNaN(number(k2))) throw badCursor();
      after = [pinned === 'true' ? 1 : 0, number(k1), number(k2), id];
    }
    const hasReplies = (row) => db.count('posts', (reply) => reply.parentId === row.id) > 0;
    const rows = db
      .filter('posts', (row) => row.courseId === r.course.id && row.parentId === null && row.lessonId === lessonId)
      .filter(
        (row) =>
          row.status === 'visible' ||
          (row.status === 'hidden' && (r.moderator || row.authorId === r.userId)) ||
          (row.status === 'deleted' && hasReplies(row)),
      )
      .filter((row) => query.filter !== 'unanswered' || !db.find('posts', (reply) => reply.parentId === row.id && reply.accepted))
      .filter((row) => query.filter !== 'mine' || row.authorId === r.userId || Boolean(db.find('posts', (reply) => reply.parentId === row.id && reply.authorId === r.userId)))
      .map((row) => ({ row, key: tuple(row) }))
      .filter(({ key }) => !after || compareKeys(key, after) > 0)
      .sort((a, b) => compareKeys(a.key, b.key));
    const items = rows.slice(0, query.limit);
    const last = items.at(-1);
    const more = rows.length > query.limit && last;
    return {
      items: items.map(({ row }) => row),
      nextCursor: more ? encodeCursor([String(Boolean(last.row.pinned)), String(last.key[1]), String(last.key[2]), last.row.id]) : null,
    };
  };

  // Counting and telling ---------------------------------------------------------------------------

  /** Recounts a thread's visible replies and touches its activity. */
  const recount = (db, parentId) => {
    const visible = db.filter('posts', (row) => row.parentId === parentId && row.status === 'visible');
    db.update('posts', parentId, (row) => ({
      replyCount: visible.length,
      lastActivityAt: Math.max(row.createdAt, ...visible.map((reply) => reply.createdAt)),
    }));
  };

  const recountVotes = (db, postId) => db.update('posts', postId, { voteCount: db.count('votes', (row) => row.postId === postId) });

  const resolveReportsOf = (ctx, postId, resolution) => {
    for (const report of ctx.db.filter('reports', (row) => row.postId === postId && !row.resolvedAt)) {
      ctx.db.update('reports', report.id, { resolvedAt: ctx.now, resolvedBy: ctx.auth.userId, resolution });
    }
  };

  const announce = (r, lessonId, threadId, postId, change) =>
    server.emitToCourse(r.course.id, 'discussion:changed', { courseId: r.course.id, lessonId, threadId, postId, change });

  const newPost = (r, fields) =>
    r.ctx.db.put('posts', {
      id: randomId(),
      schoolId: r.course.schoolId,
      courseId: r.course.id,
      lessonId: null,
      parentId: null,
      authorId: r.userId,
      title: null,
      status: 'visible',
      pinned: false,
      locked: false,
      accepted: false,
      replyCount: 0,
      voteCount: 0,
      lastActivityAt: r.ctx.now,
      editedAt: null,
      moderatedBy: null,
      moderatedAt: null,
      createdAt: r.ctx.now,
      ...fields,
    });

  // Reading ---------------------------------------------------------------------------------------

  router.add('GET', `${C}/discussions`, { school: 'student', params: course, query: discussionQuery }, (ctx) => {
    const r = reader(ctx);
    const page = topLevel(r, null, ctx.query);
    return { items: page.items.map((row) => toPost(r, row)), nextCursor: page.nextCursor };
  });

  router.add('POST', `${C}/discussions`, { school: 'student', params: course, body: newThreadInput }, (ctx) => {
    const r = reader(ctx);
    const created = newPost(r, { title: ctx.body.title, body: ctx.body.body });
    server.discussionPosted({ course: r.course, post: created });
    announce(r, null, created.id, created.id, 'created');
    return describeThread(r, created.id);
  });

  // Before `discussions/:postId`, which would take "reports" for an id.
  router.add('GET', `${C}/discussions/reports`, { school: 'instructor', params: course }, (ctx) => {
    const r = reader(ctx);
    if (!r.moderator) throw forbidden("Only the course's editors see its reports.");
    const { db } = ctx;
    return db
      .filter('reports', (row) => row.courseId === r.course.id && !row.resolvedAt)
      .sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1))
      .slice(0, 200)
      .flatMap((row) => {
        const reported = db.get('posts', row.postId);
        if (!reported) return [];
        const thread = reported.parentId ? db.get('posts', reported.parentId) : null;
        const lesson = reported.lessonId ? db.get('lessons', reported.lessonId) : null;
        const reporter = row.reporterId ? db.get('users', row.reporterId) : null;
        return [
          {
            id: row.id,
            reason: row.reason,
            note: row.note,
            reporter: row.reporterId ? { id: row.reporterId, name: reporter?.name ?? '' } : null,
            createdAt: iso(row.createdAt),
            post: toPost(r, reported),
            context: { threadId: reported.parentId ?? reported.id, threadTitle: thread?.title ?? reported.title, lessonId: reported.lessonId, lessonTitle: lesson?.title ?? null },
          },
        ];
      });
  });

  router.add(
    'POST',
    `${C}/discussions/reports/:reportId/resolve`,
    { school: 'instructor', params: { courseSlug, reportId: uuid }, body: resolveReportInput, status: 204 },
    (ctx) => {
      const r = reader(ctx);
      if (!r.moderator) throw forbidden("Only the course's editors deal with reports.");
      const { db } = ctx;
      const report = db.get('reports', ctx.params.reportId);
      if (!report || report.courseId !== r.course.id) throw notFound('This report');
      if (report.resolvedAt) throw conflict('This report was already dealt with.');
      if (ctx.body.action === 'hide') {
        const reported = db.get('posts', report.postId);
        const hiding = reported?.status === 'visible';
        if (hiding) db.update('posts', reported.id, { status: 'hidden', accepted: false, moderatedBy: ctx.auth.userId, moderatedAt: ctx.now });
        resolveReportsOf(ctx, report.postId, 'hidden');
        if (hiding && reported.parentId) recount(db, reported.parentId);
        if (hiding) announce(r, reported.lessonId, reported.parentId ?? reported.id, reported.id, 'updated');
      } else {
        db.update('reports', report.id, { resolvedAt: ctx.now, resolvedBy: ctx.auth.userId, resolution: 'dismissed' });
      }
    },
  );

  router.add('GET', `${C}/discussions/:postId`, { school: 'student', params: post }, (ctx) => describeThread(reader(ctx), ctx.params.postId));

  router.add('POST', `${C}/discussions/:postId/replies`, { school: 'student', params: post, body: newPostInput }, (ctx) => {
    const r = reader(ctx);
    const parent = postFor(r, ctx.params.postId);
    if (parent.parentId) throw conflict('Reply to the thread, not to a reply.');
    if (parent.status !== 'visible') throw conflict("This post can't take replies.");
    if (parent.locked && !r.moderator) throw lockedThread();
    const reply = newPost(r, { lessonId: parent.lessonId, parentId: parent.id, body: ctx.body.body });
    recount(ctx.db, parent.id);
    server.discussionReplied({ course: r.course, post: reply, parent: ctx.db.get('posts', parent.id) });
    announce(r, parent.lessonId, parent.id, reply.id, 'created');
    return toPost(r, reply);
  });

  router.add('PATCH', `${C}/discussions/:postId`, { school: 'student', params: post, body: editPostInput }, (ctx) => {
    const r = reader(ctx);
    const found = postFor(r, ctx.params.postId);
    if (found.authorId !== r.userId || found.status === 'deleted') throw forbidden('Only its author can edit a post.');
    if (ctx.body.title !== undefined && found.title === null) {
      throw new HttpError(400, 'validation_failed', 'Only threads have titles.', [{ path: 'title', message: 'Only threads have titles' }]);
    }
    const updated = ctx.db.update('posts', found.id, { body: ctx.body.body, ...(ctx.body.title !== undefined && { title: ctx.body.title }), editedAt: ctx.now });
    announce(r, found.lessonId, found.parentId ?? found.id, found.id, 'updated');
    return toPost(r, updated);
  });

  /** Deleting: a post with replies leaves a placeholder (its text is wiped), one without is removed. */
  router.add('DELETE', `${C}/discussions/:postId`, { school: 'student', params: post }, (ctx) => {
    const r = reader(ctx);
    const { db } = ctx;
    const found = postFor(r, ctx.params.postId);
    if (found.authorId !== r.userId && !r.moderator) throw forbidden('Only its author or a moderator can delete a post.');
    if (found.status === 'deleted') return;
    if (db.count('posts', (row) => row.parentId === found.id) > 0) {
      db.update('posts', found.id, { status: 'deleted', body: '[deleted]', ...(found.title !== null && { title: '[deleted]' }), pinned: false });
    } else {
      removePosts(db, [found.id]);
    }
    if (found.parentId) {
      recount(db, found.parentId);
      // A deleted thread whose last reply just went goes too.
      const parent = db.get('posts', found.parentId);
      if (parent?.status === 'deleted' && !db.count('posts', (row) => row.parentId === parent.id)) removePosts(db, [parent.id]);
    }
    announce(r, found.lessonId, found.parentId ?? found.id, found.id, 'removed');
  });

  /** Marks a post helpful, or not. Not one's own. */
  const vote = (helpful) => (ctx) => {
    const r = reader(ctx);
    const { db } = ctx;
    const found = postFor(r, ctx.params.postId);
    if (found.status !== 'visible') throw conflict("This post can't be voted on.");
    if (found.authorId === r.userId) throw conflict("You can't mark your own post helpful.");
    const id = `${found.id}:${r.userId}`;
    if (helpful && !db.get('votes', id)) db.put('votes', { id, schoolId: found.schoolId, postId: found.id, userId: r.userId, createdAt: ctx.now });
    if (!helpful) db.remove('votes', id);
    const updated = recountVotes(db, found.id);
    announce(r, found.lessonId, found.parentId ?? found.id, found.id, 'updated');
    return { voteCount: updated.voteCount, voted: helpful };
  };
  router.add('PUT', `${C}/discussions/:postId/vote`, { school: 'student', params: post }, vote(true));
  router.add('DELETE', `${C}/discussions/:postId/vote`, { school: 'student', params: post }, vote(false));

  // Moderation ------------------------------------------------------------------------------------

  router.add('POST', `${C}/discussions/:postId/moderate`, { school: 'instructor', params: post, body: moderatePostInput, status: 200 }, (ctx) => {
    const r = reader(ctx);
    if (!r.moderator) throw forbidden("Only the course's editors moderate its discussions.");
    const { db, body: input } = ctx;
    const found = postFor(r, ctx.params.postId);
    if (found.status === 'deleted') throw conflict('This post was deleted.');
    const topLevelPost = found.parentId === null;
    if (!topLevelPost && (input.pinned !== undefined || input.locked !== undefined)) throw conflict('Only threads and lesson comments can be pinned or locked.');
    if (topLevelPost && input.accepted !== undefined) throw conflict('Only a reply can be the answer.');

    const changes = {};
    if (input.pinned !== undefined) changes.pinned = input.pinned;
    if (input.locked !== undefined) changes.locked = input.locked;
    if (input.hidden !== undefined) changes.status = input.hidden ? 'hidden' : 'visible';
    if (input.accepted !== undefined) {
      if (input.accepted && (input.hidden ?? found.status === 'hidden')) throw conflict("A hidden reply can't be the answer.");
      changes.accepted = input.accepted;
      // One answer per thread.
      if (input.accepted) for (const other of db.filter('posts', (row) => row.parentId === found.parentId && row.accepted)) db.update('posts', other.id, { accepted: false });
    }
    if (input.hidden) changes.accepted = false;
    const updated = db.update('posts', found.id, { ...changes, moderatedBy: ctx.auth.userId, moderatedAt: ctx.now });
    if (input.hidden !== undefined) {
      if (input.hidden) resolveReportsOf(ctx, found.id, 'hidden');
      if (found.parentId) recount(db, found.parentId);
    }
    announce(r, found.lessonId, found.parentId ?? found.id, found.id, 'updated');
    return toPost(r, db.get('posts', updated.id));
  });

  /** Flags a post for the course's editors. Once per person and post, never one's own. */
  router.add('POST', `${C}/discussions/:postId/report`, { school: 'student', params: post, body: reportPostInput, status: 204 }, (ctx) => {
    const r = reader(ctx);
    const { db } = ctx;
    const found = postFor(r, ctx.params.postId);
    if (found.status !== 'visible') throw conflict('This post is already out of view.');
    if (found.authorId === r.userId) throw conflict("You can't report your own post.");
    if (db.find('reports', (row) => row.postId === found.id && row.reporterId === r.userId)) throw conflict("You've already reported this post.");
    const report = db.put('reports', {
      id: randomId(),
      schoolId: found.schoolId,
      courseId: r.course.id,
      postId: found.id,
      reporterId: r.userId,
      reason: ctx.body.reason,
      note: ctx.body.note,
      createdAt: ctx.now,
      resolvedAt: null,
      resolvedBy: null,
      resolution: null,
    });
    server.discussionReported({ course: r.course, post: found, report });
  });

  // Lesson comments -------------------------------------------------------------------------------

  const lessonParams = { courseSlug, lessonId: uuid };

  router.add('GET', `${C}/lessons/:lessonId/comments`, { school: 'student', params: lessonParams, query: discussionQuery }, (ctx) => {
    const r = reader(ctx);
    const lesson = lessonFor(r, ctx.params.lessonId);
    const page = topLevel(r, lesson.id, ctx.query);
    return { items: page.items.map((row) => toThread(r, row, lesson)), nextCursor: page.nextCursor };
  });

  router.add('POST', `${C}/lessons/:lessonId/comments`, { school: 'student', params: lessonParams, body: newPostInput }, (ctx) => {
    const r = reader(ctx);
    const lesson = lessonFor(r, ctx.params.lessonId);
    const created = newPost(r, { lessonId: lesson.id, body: ctx.body.body });
    server.discussionPosted({ course: r.course, post: created });
    announce(r, lesson.id, created.id, created.id, 'created');
    return describeThread(r, created.id);
  });
}

/** Removes posts with everything that hangs off them: replies, votes, reports (the database's cascades). */
export function removePosts(db, postIds) {
  const ids = new Set(postIds);
  for (const reply of db.filter('posts', (row) => ids.has(row.parentId))) ids.add(reply.id);
  db.removeWhere('votes', (row) => ids.has(row.postId));
  db.removeWhere('reports', (row) => ids.has(row.postId));
  for (const id of ids) db.remove('posts', id);
}
