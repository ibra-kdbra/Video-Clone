import { createRandom, stableId } from './ids.js';
import { REMINDER_MS } from './live.js';
import * as notices from './notices.js';

/**
 * The demo school's discussions, lesson comments, reports and live classes (social.js) as the
 * API would hold them, added to the seed by buildSeed: posts with their counts, votes and
 * moderation, the classes with their chat and attendance, the reminders and starts still to come
 * (as jobs), and the notifications all this would have sent the personas.
 *
 * The live classes are an occurrence: their times count from `occurrence`, the start of the visit,
 * and their ids, transcripts and jobs belong to it, so a later visit gets fresh ones (core.js keeps
 * the visitor's own changes to an occurrence only where they changed a class themselves).
 *
 * Classmates who write in a course they aren't enrolled in are enrolled first (a few days before);
 * personas must already be. Anything that can't be (a post before its lesson came out, someone
 * writing before they joined the school) is reported as a problem, which fails the tests.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const socialIds = {
  thread: (course, key) => stableId('post', course, key),
  reply: (course, thread, key) => stableId('post', course, thread, key),
  comment: (course, key) => stableId('post', course, 'comment', key),
  commentReply: (course, comment, key) => stableId('post', course, 'comment', comment, key),
  report: (course, thread, reply) => stableId('report', course, thread, reply ?? ''),
  /** A seeded class, in one occurrence of the seeded classes (each visit's starts afresh: see core.js). */
  live: (key, occurrence) => stableId('live', key, occurrence),
  liveMessage: (key, occurrence, index) => stableId('live-message', key, occurrence, index),
  /** Reminders, starts and ends still to come, for one occurrence. */
  liveJob: (type, key, occurrence) => stableId('job', type, key, occurrence),
};

/** A class's start: on the hour when it's hours away, else on a five-minute mark (not sooner than asked). */
export function liveStart(anchor, minutes) {
  const target = anchor + minutes * MINUTE;
  if (Math.abs(minutes) >= 180) return Math.round(target / HOUR) * HOUR;
  const step = 5 * MINUTE;
  return minutes < 0 ? Math.floor(target / step) * step : Math.ceil(target / step) * step;
}

export function seedSocial({ social, tables, put: putRow, anchor, occurrence = anchor, people, courses, enroll, notify, personaMembers, schoolSlug }) {
  const problems = [];
  // The seeded live classes belong to an occurrence: their times count from `occurrence` (the
  // visit's first page load) rather than from this page load, and they last until `occurrenceEnds`.
  let occurrenceEnds = occurrence + HOUR;
  const put = (table, row) => {
    putRow(table, row);
    return row;
  };
  const fail = (where, message) => problems.push(`${where}: ${message}`);
  const bySlug = new Map(courses.map((item) => [item.spec.slug, item]));
  const personaIds = new Set(personaMembers.map((member) => member.id));
  const personaById = new Map(personaMembers.map((member) => [member.id, member]));
  const at = (daysAgo) => anchor - Math.round((daysAgo * DAY) / MINUTE) * MINUTE;
  const member = (key, where) => {
    const found = people.get(key);
    if (!found) fail(where, `unknown person "${key}"`);
    return found ?? null;
  };

  const isEditor = (person, course) => person.role === 'owner' || person.role === 'admin' || (person.role === 'instructor' && course.createdBy === person.id);
  const enrollmentOf = (course, person) => tables.enrollments.get(`${course.id}:${person.id}`) ?? null;

  /** This person may take part in the course at `time`: an editor, or enrolled by then (classmates are enrolled if they need to be). */
  function takePart(where, person, item, time) {
    const { course } = item;
    if (time > anchor) fail(where, 'is in the future');
    if (course.publishedAt === null || time <= course.publishedAt) fail(where, 'is before the course was published');
    if (isEditor(person, course)) return;
    const random = createRandom(`social-enroll/${course.id}/${person.id}`);
    const earliest = Math.max(course.publishedAt ?? Infinity, person.joined) + HOUR;
    const wanted = time - random.between(0.5, 4) * DAY;
    const enrollment = enrollmentOf(course, person);
    if (enrollment && enrollment.createdAt <= time - 10 * MINUTE) return;
    if (personaIds.has(person.id)) {
      fail(where, enrollment ? `${person.key} enrolled in ${course.slug} after this` : `${person.key} isn't enrolled in ${course.slug}`);
      return;
    }
    if (earliest > time - 10 * MINUTE) {
      fail(where, `${person.key} joined the school after this`);
      return;
    }
    if (enrollment) tables.enrollments.set(enrollment.id, { ...enrollment, createdAt: Math.max(earliest, wanted) });
    else enroll(course, person, Math.max(earliest, wanted));
  }

  /** Who looks after a course's discussions: its author while they're on the staff, else the admins and the owner. */
  function moderatorsOf(course) {
    const staff = [...people.values()].filter((person) => person.role !== 'student');
    const author = staff.find((person) => person.id === course.createdBy);
    return author ? [author.id] : staff.filter((person) => person.role === 'owner' || person.role === 'admin').map((person) => person.id);
  }

  /** A notification for each persona among `recipients`, as the worker would have written it then. */
  function tell(recipients, type, data, time, ref) {
    for (const id of new Set(recipients)) {
      const persona = personaById.get(id);
      if (persona) notify(persona, type, data, time, ref);
    }
  }

  function vote(post, spec, item, where) {
    if (post.status !== 'visible') return;
    const { course } = item;
    const random = createRandom(`votes/${post.id}`);
    const explicit = (spec.voters ?? []).map((key) => member(key, where)).filter(Boolean);
    const voters = [];
    for (const person of explicit) {
      if (person.id === post.authorId) fail(where, `${person.key} can't mark their own post helpful`);
      const from = Math.max(post.createdAt, enrollmentOf(course, person)?.createdAt ?? post.createdAt) + MINUTE;
      const time = from + random.between(0.05, 0.9) * Math.max(MINUTE, anchor - from);
      takePart(`${where} (a vote)`, person, item, time);
      voters.push({ person, time });
    }
    const want = Math.max(spec.votes ?? 0, explicit.length) - explicit.length;
    const taken = new Set([post.authorId, ...explicit.map((person) => person.id)]);
    const candidates = [...people.values()].filter((person) => !taken.has(person.id) && !personaIds.has(person.id) && (isEditor(person, course) || enrollmentOf(course, person)));
    for (const person of random.sample(candidates, Math.min(want, candidates.length))) {
      const from = Math.max(post.createdAt, enrollmentOf(course, person)?.createdAt ?? post.createdAt) + MINUTE;
      voters.push({ person, time: from + random.next() * Math.max(MINUTE, anchor - from - MINUTE) });
    }
    if (want > candidates.length) fail(where, `only ${candidates.length} people could mark it helpful`);
    for (const { person, time } of voters) put('votes', { id: `${post.id}:${person.id}`, schoolId: post.schoolId, postId: post.id, userId: person.id, createdAt: Math.min(time, anchor) });
    post.voteCount = voters.length;
  }

  /** A thread or lesson comment with its replies, votes, moderation and notifications. */
  function topLevel(item, spec, { id, lesson, where, replyId }) {
    const { course } = item;
    const author = member(spec.author, where);
    if (!author) return;
    const time = at(spec.daysAgo);
    takePart(where, author, item, time);
    if (lesson && (lesson.status !== 'published' || lesson.publishedAt === null || lesson.publishedAt >= time)) fail(where, `is before the lesson "${lesson.key}" came out`);
    const moderator = course.createdBy;
    const replies = [];
    for (const replySpec of spec.replies ?? []) {
      const at_ = `${where}/${replySpec.key}`;
      const replier = member(replySpec.author, at_);
      if (!replier) continue;
      const replyTime = at(replySpec.daysAgo);
      if (replyTime <= time) fail(at_, 'is before the post it replies to');
      takePart(at_, replier, item, replyTime);
      replies.push({ spec: replySpec, author: replier, time: replyTime, id: replyId(replySpec.key), where: at_ });
    }
    replies.sort((a, b) => a.time - b.time);
    const visible = replies.filter((reply) => !reply.spec.hidden);
    const moderatorReplies = replies.filter((reply) => reply.author.id === moderator).map((reply) => reply.time);
    const row = {
      id,
      schoolId: course.schoolId,
      courseId: course.id,
      lessonId: lesson?.id ?? null,
      parentId: null,
      authorId: author.id,
      title: lesson ? null : spec.title,
      body: spec.body,
      status: 'visible',
      pinned: Boolean(spec.pinned),
      locked: Boolean(spec.locked),
      accepted: false,
      replyCount: visible.length,
      voteCount: 0,
      lastActivityAt: Math.max(time, ...visible.map((reply) => reply.time)),
      editedAt: null,
      moderatedBy: spec.pinned || spec.locked ? moderator : null,
      moderatedAt: spec.pinned || spec.locked ? Math.max(time, ...moderatorReplies) + 2 * MINUTE : null,
      createdAt: time,
    };
    if (spec.hidden) Object.assign(row, { status: 'hidden', moderatedBy: moderator, moderatedAt: at(spec.hidden.daysAgo) });
    if (spec.deleted) Object.assign(row, { status: 'deleted', body: '[deleted]', title: row.title === null ? null : '[deleted]', pinned: false });
    vote(row, spec, item, where);
    put('posts', row);

    // The course's staff heard about the post, and its author about each reply (the worker's rules).
    if (!spec.hidden) {
      tell(
        moderatorsOf(course).filter((userId) => userId !== author.id),
        'discussion.posted',
        notices.posted({ school: schoolSlug, course, post: { ...row, title: spec.title ?? null, body: spec.body }, lesson, authorName: author.name }),
        time + MINUTE,
        `posted/${id}`,
      );
    }

    for (const reply of replies) {
      const hidden = Boolean(reply.spec.hidden);
      const replyRow = {
        id: reply.id,
        schoolId: course.schoolId,
        courseId: course.id,
        lessonId: row.lessonId,
        parentId: id,
        authorId: reply.author.id,
        title: null,
        body: reply.spec.body,
        status: hidden ? 'hidden' : 'visible',
        pinned: false,
        locked: false,
        accepted: Boolean(reply.spec.accepted),
        replyCount: 0,
        voteCount: 0,
        lastActivityAt: reply.time,
        editedAt: null,
        moderatedBy: hidden || reply.spec.accepted ? moderator : null,
        moderatedAt: hidden ? at(reply.spec.hidden.daysAgo) : reply.spec.accepted ? reply.time + 30 * MINUTE : null,
        createdAt: reply.time,
      };
      if (hidden && replyRow.moderatedAt <= reply.time) fail(reply.where, 'is hidden before it was written');
      vote(replyRow, reply.spec, item, reply.where);
      put('posts', replyRow);
      if (!hidden) {
        tell(
          [author.id].filter((userId) => userId !== reply.author.id),
          'discussion.reply',
          notices.replied({ school: schoolSlug, course, parent: { ...row, title: spec.title ?? null }, reply: replyRow, lesson, authorName: reply.author.name }),
          reply.time + MINUTE,
          `reply/${reply.id}`,
        );
      }
    }
  }

  // Threads and lesson comments ---------------------------------------------------------------------

  for (const [slug, threads] of Object.entries(social.THREADS ?? {})) {
    const item = bySlug.get(slug);
    if (!item) {
      fail(`THREADS.${slug}`, 'unknown course');
      continue;
    }
    for (const spec of threads) {
      topLevel(item, spec, { id: socialIds.thread(slug, spec.key), lesson: null, where: `THREADS.${slug}.${spec.key}`, replyId: (key) => socialIds.reply(slug, spec.key, key) });
    }
  }
  for (const [slug, comments] of Object.entries(social.COMMENTS ?? {})) {
    const item = bySlug.get(slug);
    if (!item) {
      fail(`COMMENTS.${slug}`, 'unknown course');
      continue;
    }
    for (const spec of comments) {
      const where = `COMMENTS.${slug}.${spec.key}`;
      const lesson = item.lessons.find((row) => row.key === spec.lesson);
      if (!lesson) {
        fail(where, `unknown lesson "${spec.lesson}"`);
        continue;
      }
      topLevel(item, spec, { id: socialIds.comment(slug, spec.key), lesson, where, replyId: (key) => socialIds.commentReply(slug, spec.key, key) });
    }
  }

  // Reports ---------------------------------------------------------------------------------------

  for (const [index, spec] of (social.REPORTS ?? []).entries()) {
    const where = `REPORTS[${index}]`;
    const item = bySlug.get(spec.course);
    const reporter = member(spec.reporter, where);
    if (!item || !reporter) {
      if (!item) fail(where, `unknown course "${spec.course}"`);
      continue;
    }
    const postId = spec.reply ? socialIds.reply(spec.course, spec.thread, spec.reply) : socialIds.thread(spec.course, spec.thread);
    const post = tables.posts.get(postId);
    if (!post) {
      fail(where, 'unknown post');
      continue;
    }
    const time = at(spec.daysAgo);
    if (time <= post.createdAt) fail(where, 'is before the post was written');
    if (post.authorId === reporter.id) fail(where, "can't report one's own post");
    takePart(where, reporter, item, time);
    const resolvedAt = spec.resolved ? at(spec.resolved.daysAgo) : null;
    if (spec.resolved && resolvedAt <= time) fail(where, 'is settled before it was made');
    if (spec.resolved?.action === 'hidden' && post.status !== 'hidden') fail(where, 'hid the post, but the post isn’t hidden');
    if (!spec.resolved && post.status !== 'visible') fail(where, 'an open report needs a visible post');
    const report = put('reports', {
      id: socialIds.report(spec.course, spec.thread, spec.reply),
      schoolId: post.schoolId,
      courseId: post.courseId,
      postId,
      reporterId: reporter.id,
      reason: spec.reason,
      note: spec.note ?? '',
      createdAt: time,
      resolvedAt,
      resolvedBy: spec.resolved ? item.course.createdBy : null,
      resolution: spec.resolved?.action ?? null,
    });
    tell(
      moderatorsOf(item.course).filter((userId) => userId !== reporter.id),
      'discussion.reported',
      notices.reported({ school: schoolSlug, course: item.course, report }),
      time + MINUTE,
      `report/${index}`,
    );
  }

  // Live classes ----------------------------------------------------------------------------------

  for (const spec of social.LIVE ?? []) {
    const where = `LIVE.${spec.key}`;
    const item = bySlug.get(spec.course);
    const host = member(spec.host, where);
    if (!item || !host) {
      if (!item) fail(where, `unknown course "${spec.course}"`);
      continue;
    }
    const { course } = item;
    if (!isEditor(host, course)) fail(where, `${host.key} doesn't run ${course.slug}'s classes`);
    const id = socialIds.live(spec.key, occurrence);
    const startsAt = liveStart(occurrence, spec.startsInMinutes);
    const createdAt = at(spec.createdDaysAgo ?? 7);
    if (createdAt <= (course.publishedAt ?? Infinity)) fail(where, 'was scheduled before the course was published');
    const started = spec.status === 'live' || spec.status === 'ended';
    const startedAt = spec.status === 'live' ? startsAt : spec.status === 'ended' ? startsAt + MINUTE : null;
    const endedAt = spec.status === 'ended' ? startsAt + (spec.endedAfterMinutes ?? spec.durationMinutes) * MINUTE : null;
    if (started && startedAt > occurrence) fail(where, 'starts in the future but has started');
    if (endedAt !== null && endedAt > occurrence) fail(where, 'ends in the future but has ended');
    if (spec.status === 'scheduled' && startsAt <= occurrence) fail(where, 'is scheduled in the past');
    const session = put('liveSessions', {
      id,
      key: spec.key,
      schoolId: course.schoolId,
      courseId: course.id,
      title: spec.title,
      description: spec.description ?? '',
      startsAt,
      durationMinutes: spec.durationMinutes,
      status: spec.status,
      provider: spec.provider,
      streamRef: spec.streamRef ?? null,
      recordingRef: spec.recordingRef ?? null,
      startedAt,
      endedAt,
      createdBy: host.id,
      createdAt,
      // Which occurrence of the seeded classes this is (see `occurrence` above).
      occurrence,
    });

    // The chat, and who came.
    const random = createRandom(`live/${spec.key}`);
    const came = new Map();
    const attend = (person, from, to) => {
      const seen = came.get(person.id);
      came.set(person.id, { person, joinedAt: Math.min(seen?.joinedAt ?? from, from), lastSeenAt: Math.max(seen?.lastSeenAt ?? to, to) });
    };
    const until = endedAt ?? occurrence;
    for (const [index, [minute, authorKey, body, flags = {}]] of (spec.transcript ?? []).entries()) {
      const author = member(authorKey, `${where}.transcript[${index}]`);
      if (!author) continue;
      const time = startsAt + minute * MINUTE + random.int(0, 50) * 1000;
      if (time > occurrence) fail(`${where}.transcript[${index}]`, 'is in the future');
      if (endedAt !== null && time > endedAt) fail(`${where}.transcript[${index}]`, 'is after the class ended');
      takePart(`${where}.transcript[${index}]`, author, item, time);
      put('liveMessages', {
        id: socialIds.liveMessage(spec.key, occurrence, index),
        schoolId: course.schoolId,
        sessionId: id,
        userId: author.id,
        body,
        hiddenAt: flags.hidden ? time + random.int(20, 60) * 1000 : null,
        hiddenBy: flags.hidden ? host.id : null,
        createdAt: time,
        scripted: false,
      });
      attend(author, Math.max(startsAt - 12 * MINUTE, time - random.between(1, 10) * MINUTE), Math.min(until, time + random.between(5, 40) * MINUTE));
    }
    if (started) {
      attend(host, startsAt - random.between(3, 8) * MINUTE, until);
      for (const key of spec.attendees?.include ?? []) {
        const person = member(key, where);
        if (!person) continue;
        const from = startsAt + random.between(-8, 10) * MINUTE;
        takePart(where, person, item, from);
        attend(person, from, Math.min(until, from + random.between(20, 60) * MINUTE));
      }
      const others = [...people.values()].filter((person) => !came.has(person.id) && !personaIds.has(person.id) && person.role === 'student' && enrollmentOf(course, person)?.createdAt < startsAt - HOUR);
      const more = Math.max(0, (spec.attendees?.count ?? 0) - came.size);
      for (const person of random.sample(others, Math.min(more, others.length))) {
        const from = startsAt + random.between(-10, Math.max(-9, Math.min(25, (until - startsAt) / MINUTE - 1))) * MINUTE;
        attend(person, from, spec.status === 'live' ? occurrence - random.int(0, 4) * MINUTE : Math.min(until, from + random.between(15, 60) * MINUTE));
      }
    }
    for (const { person, joinedAt, lastSeenAt } of came.values()) {
      put('liveAttendance', { id: `${id}:${person.id}`, schoolId: course.schoolId, sessionId: id, userId: person.id, joinedAt: Math.min(joinedAt, occurrence), lastSeenAt: Math.min(Math.max(lastSeenAt, joinedAt), occurrence) });
    }

    // What the personas were told (students of the course; the host too, for the reminder), and what's still to come.
    const studentsBy = (time) => [...people.values()].filter((person) => person.id !== host.id && enrollmentOf(course, person)?.createdAt < time).map((person) => person.id);
    tell(studentsBy(createdAt), 'live.scheduled', notices.liveScheduled({ school: schoolSlug, course, session }), createdAt + MINUTE, `live-scheduled/${id}`);
    if (startsAt - REMINDER_MS <= occurrence && spec.status !== 'cancelled') {
      const remindedAt = startsAt - REMINDER_MS;
      tell([...studentsBy(remindedAt), host.id], 'live.reminder', notices.liveReminder({ school: schoolSlug, course, session, minutes: 15 }), remindedAt, `live-reminder/${id}`);
    }
    if (started) tell(studentsBy(startedAt), 'live.started', notices.liveStarted({ school: schoolSlug, course, session }), startedAt + MINUTE, `live-started/${id}`);
    // Still to come in this occurrence: the reminder, the start, and the end, on time (each only
    // when the visitor doesn't run the class; see core.js).
    const endsAt = startsAt + spec.durationMinutes * MINUTE;
    if (spec.status === 'scheduled') {
      if (startsAt - REMINDER_MS > occurrence) put('jobs', { id: socialIds.liveJob('reminder', spec.key, occurrence), type: 'liveReminder', at: startsAt - REMINDER_MS, payload: { sessionId: id } });
      put('jobs', { id: socialIds.liveJob('autostart', spec.key, occurrence), type: 'liveAutoStart', at: startsAt, payload: { sessionId: id } });
    }
    if (spec.status === 'scheduled' || spec.status === 'live') {
      put('jobs', { id: socialIds.liveJob('autoend', spec.key, occurrence), type: 'liveAutoEnd', at: endsAt, payload: { sessionId: id } });
      // The occurrence lasts until the classes of its next few hours are over.
      if (startsAt <= occurrence + 3 * HOUR) occurrenceEnds = Math.max(occurrenceEnds, endsAt);
    }
  }

  return { problems, occurrenceEnds };
}
