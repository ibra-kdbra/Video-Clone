import {
  EMBED_PROVIDERS,
  EMBED_REF_FORMAT,
  LESSON_KINDS,
  LIVE_STATUSES,
  REPORT_REASONS,
  ROLE_RANK,
  ROLES,
  assignmentInput,
  courseSlug,
  courseTitle,
  createLiveSessionInput,
  displayName,
  email,
  liveMessageInput,
  newPostInput,
  newThreadInput,
  plainText,
  quizInput,
  reportPostInput,
  schoolName,
  schoolSlug,
  youtubeRef,
} from '@grand/contracts';

/**
 * Checks the demo content (content.js and media.js) against the API's own rules, so the demo
 * never shows something the real app couldn't hold. Returns a list of problems (empty when all is
 * well); development and the tests fail loudly on any.
 */
const SUBMISSION_STATUSES = ['draft', 'submitted', 'graded', 'returned'];

/** The percentages a quiz can score (every combination of right and wrong questions). */
export function reachablePercents(questions) {
  const points = questions.map((question) => question.points ?? 1);
  const max = points.reduce((sum, value) => sum + value, 0);
  const sums = new Set([0]);
  for (const value of points) for (const sum of [...sums]) sums.add(sum + value);
  return [...new Set([...sums].map((sum) => (max ? Math.round((sum / max) * 100) : 0)))].sort((a, b) => a - b);
}

export function validateContent({ SCHOOL, PEOPLE, COURSES, START, FEEDBACK, ANSWERS, DEMO_PASSWORD }, MEDIA = {}) {
  const problems = [];
  const fail = (where, message) => problems.push(`${where}: ${message}`);
  const check = (where, schema, value) => {
    const result = schema.safeParse(value);
    if (!result.success) for (const issue of result.error.issues) fail(where, `${issue.path.join('.') || 'value'}: ${issue.message}`);
    return result.success;
  };

  if (!SCHOOL) fail('SCHOOL', 'missing');
  else {
    check('SCHOOL.slug', schoolSlug, SCHOOL.slug);
    check('SCHOOL.name', schoolName, SCHOOL.name);
  }
  if (typeof DEMO_PASSWORD !== 'string' || !DEMO_PASSWORD) fail('DEMO_PASSWORD', 'missing');

  // People
  const people = new Map();
  const emails = new Set();
  for (const [index, person] of (PEOPLE ?? []).entries()) {
    const where = `PEOPLE[${index}] (${person.key})`;
    if (!person.key || people.has(person.key)) fail(where, 'needs a unique key');
    people.set(person.key, person);
    if (check(`${where}.email`, email, person.email)) {
      const normal = email.parse(person.email);
      if (normal !== person.email) fail(where, `email should be written as ${normal}`);
      if (emails.has(normal)) fail(where, `email ${normal} is used twice`);
      emails.add(normal);
    }
    check(`${where}.name`, displayName, person.name);
    if (!ROLES.includes(person.role)) fail(where, `unknown role "${person.role}"`);
    if (person.persona && !person.blurb) fail(where, 'a persona needs a blurb');
  }
  if ((PEOPLE ?? []).filter((person) => person.role === 'owner').length !== 1) fail('PEOPLE', 'the school needs exactly one owner');
  if (!(PEOPLE ?? []).some((person) => person.persona)) fail('PEOPLE', 'no personas to sign in as');

  // Courses
  const courses = new Map();
  for (const [index, course] of (COURSES ?? []).entries()) {
    const where = `COURSES[${index}] (${course.slug})`;
    if (!check(`${where}.slug`, courseSlug, course.slug)) continue;
    if (courses.has(course.slug)) fail(where, 'slug is used twice');
    courses.set(course.slug, course);
    check(`${where}.title`, courseTitle, course.title);
    check(`${where}.summary`, plainText(300), course.summary ?? '');
    check(`${where}.description`, plainText(20_000), course.description ?? '');
    const author = people.get(course.author);
    if (!author) fail(where, `unknown author "${course.author}"`);
    else if (ROLE_RANK[author.role] < ROLE_RANK.instructor) fail(where, `author "${course.author}" is a ${author.role}, who can't create courses`);
    if (!['draft', 'published', 'archived'].includes(course.status)) fail(where, `unknown status "${course.status}"`);
    if (course.status !== 'draft' && !(Number.isFinite(course.publishedDaysAgo) && course.publishedDaysAgo >= 0)) fail(where, 'needs publishedDaysAgo');
    if (course.cover?.youtube && !EMBED_REF_FORMAT.youtube.test(course.cover.youtube)) fail(where, `cover "${course.cover.youtube}" isn't a YouTube id`);
    if (course.cover?.media && !MEDIA[course.cover.media]) fail(where, `cover media "${course.cover.media}" isn't in media.js`);
    for (const key of ['popularity', 'difficulty']) if (!(course[key] >= 0 && course[key] <= 1)) fail(where, `${key} must be from 0 to 1`);
    if (!course.modules?.length) fail(where, 'needs at least one module');

    const lessonKeys = new Set();
    for (const [m, module] of (course.modules ?? []).entries()) {
      if (!module.title?.trim() || module.title.length > 120) fail(`${where}.modules[${m}]`, 'needs a title of up to 120 characters');
      for (const lesson of module.lessons ?? []) {
        const at = `${where} lesson "${lesson.key}"`;
        if (!lesson.key || lessonKeys.has(lesson.key)) fail(at, 'needs a key unique in its course');
        lessonKeys.add(lesson.key);
        if (!LESSON_KINDS.includes(lesson.kind)) fail(at, `unknown kind "${lesson.kind}"`);
        if (!lesson.title?.trim() || lesson.title.length > 120) fail(at, 'needs a title of up to 120 characters');
        check(`${at}.summary`, plainText(300), lesson.summary ?? '');
        check(`${at}.notes`, plainText(50_000), lesson.notes ?? '');
        if (lesson.status && !['draft', 'published'].includes(lesson.status)) fail(at, `unknown status "${lesson.status}"`);
        const video = lesson.video;
        if (video && lesson.kind !== 'lesson') fail(at, 'only lessons have a video');
        if (video?.provider === 'upload') {
          if (!MEDIA[video.media]) fail(at, `media "${video.media}" isn't in media.js`);
        } else if (video) {
          if (!EMBED_PROVIDERS.includes(video.provider)) fail(at, `unknown video provider "${video.provider}"`);
          else if (!EMBED_REF_FORMAT[video.provider].test(video.ref ?? '')) fail(at, `"${video.ref}" isn't a ${video.provider} id`);
        }
        if (lesson.kind === 'quiz') {
          if (!lesson.quiz) fail(at, 'a quiz needs `quiz`');
          else {
            const keys = new Set();
            for (const question of lesson.quiz.questions ?? []) {
              if (!question.key || keys.has(question.key)) fail(at, 'every question needs a key unique in its quiz');
              keys.add(question.key);
            }
            check(`${at}.quiz`, quizInput, {
              passPercent: lesson.quiz.passPercent,
              maxAttempts: lesson.quiz.maxAttempts,
              // eslint-disable-next-line no-unused-vars
              questions: (lesson.quiz.questions ?? []).map(({ key, ...question }) => question),
            });
          }
        }
        if (lesson.kind === 'assignment') {
          const settings = lesson.assignment;
          if (!settings) fail(at, 'an assignment needs `assignment`');
          else {
            if (settings.dueInDays !== null && settings.dueInDays !== undefined && !Number.isFinite(settings.dueInDays)) fail(at, 'dueInDays must be a number or null');
            check(`${at}.assignment`, assignmentInput, {
              maxPoints: settings.maxPoints,
              allowText: settings.allowText,
              allowFiles: settings.allowFiles,
              dueAt: Number.isFinite(settings.dueInDays) ? new Date(Date.UTC(2030, 0, 1)).toISOString() : null,
            });
          }
        }
      }
    }
  }

  // Where the personas start
  for (const [key, entries] of Object.entries(START ?? {})) {
    const person = people.get(key);
    if (!person) fail(`START.${key}`, 'unknown person');
    else if (!person.persona) fail(`START.${key}`, 'is not a persona');
    for (const [index, entry] of (entries ?? []).entries()) {
      const where = `START.${key}[${index}] (${entry.course})`;
      const course = courses.get(entry.course);
      if (!course) {
        fail(where, 'unknown course');
        continue;
      }
      if (course.status !== 'published') fail(where, "can't enroll in a course that isn't published");
      if (!(entry.enrolledDaysAgo >= 0)) fail(where, 'needs enrolledDaysAgo');
      const lessons = new Map(course.modules.flatMap((module) => module.lessons).map((lesson) => [lesson.key, lesson]));
      const lessonOf = (lessonKey, kind) => {
        const lesson = lessons.get(lessonKey);
        if (!lesson) fail(where, `unknown lesson "${lessonKey}"`);
        else if (kind && lesson.kind !== kind) fail(where, `"${lessonKey}" is a ${lesson.kind}, not a ${kind}`);
        else if ((lesson.status ?? 'published') !== 'published') fail(where, `"${lessonKey}" isn't published`);
        return lesson;
      };
      for (const lessonKey of entry.completed ?? []) lessonOf(lessonKey);
      if (entry.lastLesson) lessonOf(entry.lastLesson);
      if (entry.watching) {
        const lesson = lessonOf(entry.watching.lesson, 'lesson');
        if (lesson && lesson.video?.provider !== 'upload') fail(where, `watching "${entry.watching.lesson}" needs an uploaded video`);
        const duration = MEDIA[lesson?.video?.media]?.durationSeconds;
        if (duration && !(entry.watching.seconds >= 0 && entry.watching.seconds < duration)) fail(where, 'watching.seconds is past the end of the video');
      }
      for (const [lessonKey, percents] of Object.entries(entry.quizzes ?? {})) {
        const lesson = lessonOf(lessonKey, 'quiz');
        if (!lesson?.quiz) continue;
        if (!Array.isArray(percents) || !percents.length) fail(where, `quizzes.${lessonKey} needs a list of attempt percents`);
        if (lesson.quiz.maxAttempts !== null && percents.length > lesson.quiz.maxAttempts) fail(where, `quizzes.${lessonKey} has more attempts than the quiz allows`);
        const reachable = reachablePercents(lesson.quiz.questions ?? []);
        for (const percent of percents ?? []) {
          if (!reachable.includes(percent)) {
            const nearest = reachable.reduce((best, value) => (Math.abs(value - percent) < Math.abs(best - percent) ? value : best), reachable[0]);
            fail(where, `quizzes.${lessonKey}: ${percent}% can't be scored on this quiz (closest: ${nearest}%; possible: ${reachable.join(', ')})`);
          }
        }
      }
      for (const [lessonKey, submission] of Object.entries(entry.submissions ?? {})) {
        const lesson = lessonOf(lessonKey, 'assignment');
        if (!SUBMISSION_STATUSES.includes(submission.status)) fail(where, `submissions.${lessonKey}: unknown status "${submission.status}"`);
        if (submission.status === 'graded' && !(submission.grade >= 0 && submission.grade <= (lesson?.assignment?.maxPoints ?? Infinity))) {
          fail(where, `submissions.${lessonKey}: the grade must be from 0 to the assignment's points`);
        }
        if (submission.text && lesson?.assignment && !lesson.assignment.allowText) fail(where, `submissions.${lessonKey}: this assignment takes files only`);
        if (!(submission.daysAgo >= 0)) fail(where, `submissions.${lessonKey}: needs daysAgo`);
      }
    }
  }

  if (!Array.isArray(FEEDBACK) || !FEEDBACK.length || FEEDBACK.some((line) => typeof line !== 'string' || !line.trim())) fail('FEEDBACK', 'needs lines of text');
  if (ANSWERS !== undefined && (!Array.isArray(ANSWERS) || ANSWERS.some((line) => typeof line !== 'string' || !line.trim()))) fail('ANSWERS', 'needs lines of text');
  for (const [key, media] of Object.entries(MEDIA)) if (!(media?.durationSeconds > 0)) fail(`MEDIA.${key}`, 'needs durationSeconds');

  return problems;
}

/** The live-class providers the demo can show: no LiveKit server here. */
const DEMO_PROVIDERS = ['youtube', 'link'];
const SOME_ID = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';
/** A scripted line gets a first name filled in: leave room for it under the chat's 500 characters. */
const CHAT_LINE_MAX = 440;

/**
 * Checks the social content (social.js: discussions, lesson comments, reports, live classes and
 * the scripted chat) against the API's rules and the content it refers to: thread titles and post
 * bodies as the API takes them, replies one level deep and after what they answer, one accepted
 * reply per thread, reports once per person and never of one's own post, live classes as the API
 * would schedule them (with videos from their course's own lessons), chat messages within limits.
 * Rules that need the seed's history (who was enrolled when) are checked as it's built (seedSocial.js).
 */
export function validateSocial({ THREADS = {}, COMMENTS = {}, REPORTS = [], LIVE = [], LIVE_CHAT = null }, { PEOPLE = [], COURSES = [] }) {
  const problems = [];
  const fail = (where, message) => problems.push(`${where}: ${message}`);
  const check = (where, schema, value) => {
    const result = schema.safeParse(value);
    if (!result.success) for (const issue of result.error.issues) fail(where, `${issue.path.join('.') || 'value'}: ${issue.message}`);
    return result;
  };
  const people = new Map(PEOPLE.map((person) => [person.key, person]));
  const courses = new Map(COURSES.map((course) => [course.slug, course]));
  const lessonsOf = (course) => new Map(course.modules.flatMap((module) => module.lessons).map((lesson) => [lesson.key, lesson]));
  const canEdit = (person, course) => ROLE_RANK[person.role] >= ROLE_RANK.admin || (person.role === 'instructor' && course.author === person.key);
  const isTime = (value) => Number.isFinite(value) && value >= 0;

  const knownCourse = (where, slug) => {
    const course = courses.get(slug);
    if (!course) fail(where, `unknown course "${slug}"`);
    else if (course.status !== 'published') fail(where, `"${slug}" isn't published, so it has no discussions or classes`);
    return course;
  };
  const knownPerson = (where, key) => {
    const person = people.get(key);
    if (!person) fail(where, `unknown person "${key}"`);
    return person;
  };

  /** A thread or a lesson comment (`title` or not), its votes, its replies. */
  function post(where, spec, { thread }) {
    const author = knownPerson(where, spec.author);
    if (!spec.key) fail(where, 'needs a key');
    if (!isTime(spec.daysAgo)) fail(where, 'needs daysAgo (0 or more)');
    if (thread) check(where, newThreadInput, { title: spec.title, body: spec.body });
    else {
      if (spec.title !== undefined) fail(where, 'lesson comments have no title');
      check(where, newPostInput, { body: spec.body });
    }
    for (const flag of ['pinned', 'locked', 'deleted']) if (spec[flag] !== undefined && typeof spec[flag] !== 'boolean') fail(where, `${flag} must be true or false`);
    if (spec.accepted !== undefined) fail(where, 'only a reply can be the answer');
    if (spec.deleted && !spec.replies?.length) fail(where, 'a deleted post without replies is removed, not kept');
    if (spec.hidden && !(isTime(spec.hidden.daysAgo) && spec.hidden.daysAgo < spec.daysAgo)) fail(where, 'hidden needs a daysAgo after the post');
    votes(where, spec, author);
    const keys = new Set();
    let accepted = 0;
    for (const reply of spec.replies ?? []) {
      const at = `${where}/${reply.key}`;
      const replier = knownPerson(at, reply.author);
      if (!reply.key || keys.has(reply.key)) fail(at, 'needs a key unique in its thread');
      keys.add(reply.key);
      check(at, newPostInput, { body: reply.body });
      if (reply.title !== undefined) fail(at, 'replies have no title');
      if (reply.pinned || reply.locked) fail(at, 'only threads and lesson comments can be pinned or locked');
      if (reply.replies) fail(at, 'replies are one level deep');
      if (!(isTime(reply.daysAgo) && reply.daysAgo < spec.daysAgo)) fail(at, 'must come after the post it replies to');
      if (reply.hidden && !(isTime(reply.hidden.daysAgo) && reply.hidden.daysAgo < reply.daysAgo)) fail(at, 'hidden needs a daysAgo after the reply');
      if (reply.accepted) {
        accepted += 1;
        if (reply.hidden) fail(at, "a hidden reply can't be the answer");
      }
      votes(at, reply, replier);
    }
    if (accepted > 1) fail(where, 'only one reply can be the answer');
  }

  function votes(where, spec, author) {
    if (spec.votes !== undefined && !(Number.isInteger(spec.votes) && spec.votes >= 0)) fail(where, 'votes must be a whole number');
    const voters = spec.voters ?? [];
    if (new Set(voters).size !== voters.length) fail(where, 'a voter is listed twice');
    for (const key of voters) {
      knownPerson(where, key);
      if (author && key === author.key) fail(where, "people can't mark their own post helpful");
    }
    if ((spec.hidden || spec.deleted) && (spec.votes || voters.length)) fail(where, 'only visible posts take votes');
  }

  for (const [slug, threads] of Object.entries(THREADS)) {
    knownCourse(`THREADS.${slug}`, slug);
    const keys = new Set();
    for (const [index, thread] of threads.entries()) {
      const where = `THREADS.${slug}[${index}] (${thread.key})`;
      if (keys.has(thread.key)) fail(where, 'key is used twice in its course');
      keys.add(thread.key);
      post(where, thread, { thread: true });
    }
  }
  for (const [slug, comments] of Object.entries(COMMENTS)) {
    const course = knownCourse(`COMMENTS.${slug}`, slug);
    const lessons = course ? lessonsOf(course) : new Map();
    const keys = new Set();
    for (const [index, comment] of comments.entries()) {
      const where = `COMMENTS.${slug}[${index}] (${comment.key})`;
      if (keys.has(comment.key)) fail(where, 'key is used twice in its course');
      keys.add(comment.key);
      const lesson = lessons.get(comment.lesson);
      if (!lesson) fail(where, `unknown lesson "${comment.lesson}"`);
      else if ((lesson.status ?? 'published') !== 'published') fail(where, `"${comment.lesson}" isn't published`);
      post(where, comment, { thread: false });
    }
  }

  const reported = new Set();
  for (const [index, report] of REPORTS.entries()) {
    const where = `REPORTS[${index}]`;
    knownCourse(where, report.course);
    const reporter = knownPerson(where, report.reporter);
    check(where, reportPostInput, { reason: report.reason, note: report.note ?? '' });
    if (!REPORT_REASONS.includes(report.reason)) fail(where, `unknown reason "${report.reason}"`);
    const thread = (THREADS[report.course] ?? []).find((item) => item.key === report.thread);
    const target = report.reply ? thread?.replies?.find((item) => item.key === report.reply) : thread;
    if (!target) fail(where, 'unknown post');
    else {
      if (reporter && target.author === reporter.key) fail(where, "people can't report their own post");
      if (!(isTime(report.daysAgo) && report.daysAgo < target.daysAgo)) fail(where, 'must come after the post');
      if (report.resolved) {
        if (!['hidden', 'dismissed'].includes(report.resolved.action)) fail(where, 'resolved.action must be hidden or dismissed');
        if (!(isTime(report.resolved.daysAgo) && report.resolved.daysAgo < report.daysAgo)) fail(where, 'is settled before it was made');
        if (report.resolved.action === 'hidden' && !target.hidden) fail(where, 'hid the post, so the post must be hidden');
      } else if (target.hidden || target.deleted) fail(where, 'an open report needs a visible post');
    }
    const id = `${report.course}/${report.thread}/${report.reply ?? ''}/${report.reporter}`;
    if (reported.has(id)) fail(where, 'one report per person and post');
    reported.add(id);
  }

  const liveKeys = new Set();
  for (const [index, spec] of LIVE.entries()) {
    const where = `LIVE[${index}] (${spec.key})`;
    if (!spec.key || liveKeys.has(spec.key)) fail(where, 'needs a unique key');
    liveKeys.add(spec.key);
    const course = knownCourse(where, spec.course);
    const host = knownPerson(where, spec.host);
    if (course && host && !canEdit(host, course)) fail(where, `${spec.host} doesn't run ${spec.course}'s classes`);
    if (!DEMO_PROVIDERS.includes(spec.provider)) fail(where, `the demo shows ${DEMO_PROVIDERS.join(' and ')} classes, not "${spec.provider}"`);
    const created = check(where, createLiveSessionInput, {
      title: spec.title,
      description: spec.description ?? '',
      startsAt: new Date(Date.UTC(2030, 0, 1)).toISOString(),
      durationMinutes: spec.durationMinutes,
      provider: spec.provider,
      streamRef: spec.streamRef ?? null,
    });
    if (created.success && created.data.streamRef !== (spec.streamRef ?? null)) fail(where, `streamRef should be written as ${created.data.streamRef}`);
    if (spec.recordingRef !== null && spec.recordingRef !== undefined) {
      const recording = check(`${where}.recordingRef`, youtubeRef, spec.recordingRef);
      if (recording.success && recording.data !== spec.recordingRef) fail(where, `recordingRef should be written as ${recording.data}`);
      if (spec.status !== 'ended') fail(where, 'a recording can be added once the class is over');
    }
    // The demo shows only videos it credits: its courses' own lessons.
    const videos = course ? new Set([...lessonsOf(course).values()].filter((lesson) => lesson.video?.provider === 'youtube').map((lesson) => lesson.video.ref)) : new Set();
    for (const ref of [spec.provider === 'youtube' ? spec.streamRef : null, spec.recordingRef].filter(Boolean)) {
      if (!videos.has(ref)) fail(where, `${ref} isn't one of ${spec.course}'s lesson videos`);
    }
    if (!LIVE_STATUSES.includes(spec.status)) fail(where, `unknown status "${spec.status}"`);
    if (!Number.isFinite(spec.startsInMinutes)) fail(where, 'needs startsInMinutes');
    if (!isTime(spec.createdDaysAgo)) fail(where, 'needs createdDaysAgo');
    const startsIn = spec.startsInMinutes;
    if (spec.status === 'scheduled' && !(startsIn > 0)) fail(where, 'a scheduled class starts in the future');
    if (spec.status === 'live' && !(startsIn < 0 && -startsIn < spec.durationMinutes)) fail(where, 'a live class started earlier and hasn’t reached its end');
    if (spec.status === 'live' && spec.provider === 'youtube' && !spec.streamRef) fail(where, 'a YouTube class needs its stream before going live');
    if (spec.status === 'ended' && !(startsIn + (spec.endedAfterMinutes ?? spec.durationMinutes) < 0)) fail(where, 'an ended class ended in the past');
    if (spec.status === 'ended' && !(spec.endedAfterMinutes > 0 && spec.endedAfterMinutes <= 480)) fail(where, 'needs endedAfterMinutes');
    if (spec.status === 'cancelled' && !isTime(spec.cancelledDaysAgo)) fail(where, 'needs cancelledDaysAgo');
    if ((spec.status === 'scheduled' || spec.status === 'cancelled') && spec.transcript?.length) fail(where, 'only a class that started has a transcript');
    let previous = -Infinity;
    for (const [n, entry] of (spec.transcript ?? []).entries()) {
      const at = `${where}.transcript[${n}]`;
      const [minute, author, body, flags = {}] = Array.isArray(entry) ? entry : [];
      if (!Number.isFinite(minute) || minute < previous) fail(at, 'needs minutes from the start, in order');
      previous = minute;
      if (minute < -15) fail(at, 'the room opens 15 minutes before the start');
      if (spec.status === 'live' && !(minute * 60_000 < -startsIn * 60_000)) fail(at, 'is still to come');
      if (spec.status === 'ended' && minute > (spec.endedAfterMinutes ?? spec.durationMinutes)) fail(at, 'is after the class ended');
      knownPerson(at, author);
      check(at, liveMessageInput, { sessionId: SOME_ID, body });
      if (flags.hidden !== undefined && typeof flags.hidden !== 'boolean') fail(at, 'hidden must be true or false');
    }
    for (const key of spec.attendees?.include ?? []) knownPerson(where, key);
  }

  if (LIVE_CHAT) {
    const lines = (where, list, { min = 1 } = {}) => {
      if (!Array.isArray(list) || list.length < min) {
        fail(where, `needs at least ${min} lines`);
        return;
      }
      for (const [n, line] of list.entries()) {
        const texts = typeof line === 'string' ? [line] : [line?.ask, line?.answer];
        if (texts.some((text) => typeof text !== 'string' || !text.trim())) fail(`${where}[${n}]`, 'needs text');
        for (const text of texts.filter((item) => typeof item === 'string')) {
          if (text.length > CHAT_LINE_MAX) fail(`${where}[${n}]`, `is longer than ${CHAT_LINE_MAX} characters`);
          check(`${where}[${n}]`, liveMessageInput, { sessionId: SOME_ID, body: text });
        }
      }
    };
    for (const key of ['arrivals', 'waiting', 'openings', 'reactions', 'hostReplies', 'echoes', 'replies', 'handCalls', 'floor', 'closings']) lines(`LIVE_CHAT.${key}`, LIVE_CHAT[key]);
    for (const [slug, pool] of Object.entries({ ...LIVE_CHAT.courses, fallback: LIVE_CHAT.fallback })) {
      if (slug !== 'fallback') knownCourse(`LIVE_CHAT.courses.${slug}`, slug);
      // Each class has a pool of at least 20 things to say, so the chat doesn't repeat itself soon.
      lines(`LIVE_CHAT.courses.${slug}.lines`, pool?.lines, { min: 20 });
      lines(`LIVE_CHAT.courses.${slug}.hands`, pool?.hands, { min: 3 });
    }
    for (const spec of LIVE) {
      if (!LIVE_CHAT.courses?.[spec.course]) fail(`LIVE_CHAT.courses`, `has nothing for ${spec.course}, which has live classes`);
    }
  }

  return problems;
}
