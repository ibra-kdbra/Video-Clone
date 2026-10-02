import { PROGRESS_SEGMENT_SECONDS } from '@grand/contracts';

import { createRandom, stableId } from './ids.js';
import { formatPoints, gradeQuiz, markSegments, normalizeAnswer, segmentCount, toHex } from './logic.js';
import { seedSocial, socialIds } from './seedSocial.js';
import { reachablePercents } from './validate.js';

/**
 * The demo school as the API would hold it, built from the content (content.js, media.js): the
 * people, the courses with their modules, lessons, quizzes and assignments, and a history of what
 * the generated classmates did (enrollments, watching, quiz attempts, handed-in work, grades),
 * drawn from a seeded random generator, so it comes out the same on every visit. The personas
 * start where START puts them, and get the notifications that history would have sent them.
 *
 * Times are milliseconds, relative to `now`, so the demo always looks recent. Rows are kept per
 * table, by id, in the shapes the mock's routes work with (src/demo/routes). With `social`
 * (social.js), the school also has its discussions and live classes (seedSocial.js).
 */

export const DAY = 86_400_000;
export const HOUR = 3_600_000;
export const MINUTE = 60_000;

/** Every seeded id comes from here, so the same thing always gets the same id. */
export const ids = {
  school: (slug) => stableId('school', slug),
  user: (key) => stableId('user', key),
  course: (slug) => stableId('course', slug),
  module: (slug, index) => stableId('module', slug, index),
  lesson: (slug, key) => stableId('lesson', slug, key),
  question: (slug, lesson, key) => stableId('question', slug, lesson, key),
  option: (slug, lesson, key, index) => stableId('option', slug, lesson, key, index),
  media: (key) => stableId('media', key),
  /** A course thread (`post(course, thread)`), a reply (`post(course, thread, reply)`), a lesson comment (`post(course, 'comment', key)`)… */
  post: (course, ...keys) => stableId('post', course, ...keys),
  /** A seeded class, in the occurrence that started at `occurrence` (ms). */
  live: (key, occurrence) => socialIds.live(key, occurrence),
};

export const TABLES = [
  'users',
  'schools',
  'memberships',
  'invitations',
  'storage',
  'courses',
  'modules',
  'lessons',
  'quizzes',
  'assignments',
  'enrollments',
  'progress',
  'attempts',
  'submissions',
  'files',
  'notifications',
  'sessions',
  'jobs',
  'posts',
  'votes',
  'reports',
  'liveSessions',
  'liveMessages',
  'liveAttendance',
];

/** What instructors write when they hand work back for another try. */
const RETURN_NOTES = [
  'A good start, but the last part is missing. Finish it and hand it in again.',
  'Please show your working for the second part, then hand it in again. The first part is spot on.',
  'Close! Re-read the question: it asks you to explain why, not only what. Add that and resubmit.',
];

const PHONE_AGENT = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1';

/** About how many bytes a stored video takes (its original plus the HLS sizes). */
export const storedBytes = (durationSeconds) => Math.round(durationSeconds * 1_350_000);

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const firstName = (name) => name.split(/\s+/)[0];

/** A sample file a classmate handed in: Markdown notes, written out when downloaded. */
export function sampleFileText({ studentName, lessonTitle, body }) {
  return `# ${lessonTitle}\n\n*${studentName}*\n\n${body}\n\n## Working\n\n1. Read the question and noted what was given.\n2. Tried the method from the lesson on a small example first.\n3. Checked the result a second way before writing it up.\n`;
}

export function buildSeed({ content, media = {}, social = null, now, occurrence = null }) {
  const { SCHOOL, PEOPLE, COURSES, START = {}, FEEDBACK = [], ANSWERS = [] } = content;
  const tables = Object.fromEntries(TABLES.map((name) => [name, new Map()]));
  const put = (table, row) => tables[table].set(row.id, row);
  const anchor = Math.floor(now / MINUTE) * MINUTE;
  const daysAgo = (days) => anchor - days * DAY;
  const latest = anchor - 20 * MINUTE;

  // The school --------------------------------------------------------------------------------------
  const oldest = Math.max(30, ...COURSES.map((course) => course.publishedDaysAgo ?? 0));
  const schoolId = ids.school(SCHOOL.slug);
  const schoolCreated = daysAgo(oldest + 45) - 9 * HOUR;
  const owner = PEOPLE.find((person) => person.role === 'owner');
  put('schools', {
    id: schoolId,
    slug: SCHOOL.slug,
    name: SCHOOL.name,
    description: SCHOOL.description ?? '',
    createdAt: schoolCreated,
    createdBy: ids.user(owner.key),
  });

  // People and their memberships ---------------------------------------------------------------------
  const personas = new Set(PEOPLE.filter((person) => person.persona).map((person) => person.key));
  const startDays = (key) => Math.max(0, ...(START[key] ?? []).map((entry) => entry.enrolledDaysAgo ?? 0));
  const people = new Map();
  for (const person of PEOPLE) {
    const random = createRandom(`member/${person.key}`);
    let joined;
    if (person.role === 'owner') joined = schoolCreated;
    else if (person.role !== 'student') joined = schoolCreated + random.between(1, 12) * DAY;
    else if (personas.has(person.key)) joined = daysAgo(startDays(person.key) + random.between(6, 14));
    else if (random.chance(0.15)) joined = daysAgo(random.between(4, 25));
    else joined = schoolCreated + random.between(10, Math.max(11, oldest + 20)) * DAY;
    const id = ids.user(person.key);
    const user = {
      id,
      key: person.key,
      email: person.email,
      name: person.name,
      password: null,
      persona: Boolean(person.persona),
      emailVerified: true,
      notificationSettings: {},
      createdAt: joined - random.between(1, 30) * HOUR,
    };
    people.set(person.key, { ...user, role: person.role, joined, random });
    put('users', user);
    put('memberships', { id: `${schoolId}:${id}`, schoolId, userId: id, role: person.role, createdAt: joined });
  }
  const userId = (key) => people.get(key).id;
  const staffKeys = PEOPLE.filter((person) => person.role !== 'student').map((person) => person.key);
  const classmates = PEOPLE.filter((person) => person.role === 'student' && !personas.has(person.key));

  // Courses, modules, lessons ------------------------------------------------------------------------
  const courses = [];
  for (const [courseIndex, spec] of COURSES.entries()) {
    const random = createRandom(`course/${spec.slug}`);
    const id = ids.course(spec.slug);
    const publishedDays = spec.status === 'draft' ? null : (spec.publishedDaysAgo ?? 30);
    const publishedAt = publishedDays === null ? null : daysAgo(publishedDays) - random.between(1, 8) * HOUR;
    const createdAt = (publishedAt ?? daysAgo(random.between(3, 9))) - random.between(6, 20) * DAY;
    const course = {
      id,
      key: spec.slug,
      schoolId,
      slug: spec.slug,
      title: spec.title,
      summary: spec.summary ?? '',
      description: spec.description ?? '',
      status: spec.status,
      createdBy: userId(spec.author),
      createdAt: createdAt + courseIndex * MINUTE,
      publishedAt,
      cover: spec.cover ?? null,
    };
    put('courses', course);

    const outline = [];
    for (const [moduleIndex, moduleSpec] of spec.modules.entries()) {
      const moduleId = ids.module(spec.slug, moduleIndex);
      put('modules', { id: moduleId, courseId: id, title: moduleSpec.title, position: moduleIndex });
      for (const [position, lessonSpec] of moduleSpec.lessons.entries()) outline.push({ spec: lessonSpec, moduleId, position });
    }

    // The last two video lessons of an established course came out after it did, so the students
    // already in it heard about them.
    const age = publishedAt === null ? 0 : anchor - publishedAt;
    const late = age >= 15 * DAY ? outline.filter((item) => item.spec.kind === 'lesson').slice(-2) : [];
    const lessons = [];
    for (const [order, { spec: lessonSpec, moduleId, position }] of outline.entries()) {
      const lessonId = ids.lesson(spec.slug, lessonSpec.key);
      const status = lessonSpec.status ?? 'published';
      const video = lessonSpec.kind === 'lesson' ? (lessonSpec.video ?? null) : null;
      const lateIndex = late.findIndex((item) => item.spec === lessonSpec);
      let lessonPublished = null;
      if (status === 'published') {
        if (publishedAt === null) lessonPublished = createdAt + (order + 1) * random.between(4, 20) * HOUR;
        else if (lateIndex >= 0) lessonPublished = publishedAt + age * (lateIndex === 0 ? 0.5 : 0.85) + random.between(-6, 6) * HOUR;
        else lessonPublished = publishedAt;
      }
      const lesson = {
        id: lessonId,
        key: lessonSpec.key,
        schoolId,
        courseId: id,
        moduleId,
        kind: lessonSpec.kind,
        title: lessonSpec.title,
        summary: lessonSpec.summary ?? '',
        notes: lessonSpec.notes ?? '',
        status,
        isPreview: Boolean(lessonSpec.preview),
        position,
        videoProvider: video?.provider ?? null,
        videoRef: video && video.provider !== 'upload' ? video.ref : null,
        mediaKey: video?.provider === 'upload' ? video.media : null,
        durationSeconds: video?.provider === 'upload' ? (media[video.media]?.durationSeconds ?? null) : null,
        publishedAt: lessonPublished,
        createdAt: createdAt + (order + 1) * HOUR,
        createdBy: course.createdBy,
      };
      put('lessons', lesson);
      lessons.push(lesson);

      if (lessonSpec.kind === 'quiz') {
        const quiz = lessonSpec.quiz ?? { passPercent: 70, maxAttempts: null, questions: [] };
        put('quizzes', {
          id: lessonId,
          passPercent: quiz.passPercent,
          maxAttempts: quiz.maxAttempts ?? null,
          questions: (quiz.questions ?? []).map((question) => ({
            id: ids.question(spec.slug, lessonSpec.key, question.key),
            kind: question.kind,
            prompt: question.prompt,
            explanation: question.explanation ?? '',
            points: question.points ?? 1,
            options:
              question.kind === 'short'
                ? []
                : (question.options ?? []).map((option, index) => ({
                    id: ids.option(spec.slug, lessonSpec.key, question.key, index),
                    label: option.label,
                    correct: Boolean(option.correct),
                  })),
            answers: question.kind === 'short' ? (question.answers ?? []) : [],
          })),
        });
      }
      if (lessonSpec.kind === 'assignment') {
        const settings = lessonSpec.assignment ?? {};
        put('assignments', {
          id: lessonId,
          maxPoints: settings.maxPoints ?? 100,
          allowText: settings.allowText ?? true,
          allowFiles: settings.allowFiles ?? true,
          dueAt: Number.isFinite(settings.dueInDays) ? endOfDay(daysAgo(-settings.dueInDays)) : null,
        });
      }
    }
    courses.push({ course, spec, lessons, random });
  }

  // History ------------------------------------------------------------------------------------------
  const enroll = (course, user, at) => put('enrollments', { id: `${course.id}:${user.id}`, schoolId, courseId: course.id, userId: user.id, createdAt: at });
  const progressRow = (lesson, user, fields) => {
    const id = `${lesson.id}:${user.id}`;
    const before = tables.progress.get(id);
    const row = {
      id,
      schoolId,
      courseId: lesson.courseId,
      lessonId: lesson.id,
      userId: user.id,
      watched: '',
      watchedSeconds: 0,
      positionSeconds: 0,
      completedAt: null,
      createdAt: fields.updatedAt,
      ...before,
      ...fields,
    };
    put('progress', row);
    return row;
  };
  const watchedRow = (lesson, user, segments, { at, position = 0, complete = false }) => {
    const total = segmentCount(lesson.durationSeconds ?? 0);
    const bits = markSegments(new Uint8Array(0), segments, total);
    let count = 0;
    for (const segment of new Set(segments)) if (segment >= 0 && segment < total) count++;
    return progressRow(lesson, user, {
      watched: toHex(bits),
      watchedSeconds: Math.min(lesson.durationSeconds ?? 0, count * PROGRESS_SEGMENT_SECONDS),
      positionSeconds: Math.floor(Math.min(position, lesson.durationSeconds ?? position)),
      completedAt: complete ? at : null,
      updatedAt: at,
    });
  };
  const range = (from, to) => Array.from({ length: Math.max(0, to - from) }, (_, index) => from + index);

  const attemptsMade = new Map();
  const addAttempt = (lesson, user, answers, at) => {
    const quiz = tables.quizzes.get(lesson.id);
    const grade = gradeQuiz(quiz.questions, answers);
    const key = `${lesson.id}:${user.id}`;
    const n = (attemptsMade.get(key) ?? 0) + 1;
    attemptsMade.set(key, n);
    const passed = grade.percent >= quiz.passPercent;
    put('attempts', {
      id: stableId('attempt', lesson.id, user.id, n),
      schoolId,
      courseId: lesson.courseId,
      lessonId: lesson.id,
      userId: user.id,
      answers,
      results: grade.results,
      score: grade.score,
      maxScore: grade.maxScore,
      percent: grade.percent,
      passed,
      createdAt: at,
    });
    if (passed) progressRow(lesson, user, { completedAt: tables.progress.get(key)?.completedAt ?? at, updatedAt: at });
    return passed;
  };

  /** Answers that are right for the questions in `right`, wrong for the rest. */
  const answersFor = (questions, right, random) =>
    Object.fromEntries(
      questions.map((question) => {
        const correct = right.has(question.id);
        if (question.kind === 'short') return [question.id, correct ? rightText(question, random) : wrongText(question, random)];
        const rightIds = question.options.filter((option) => option.correct).map((option) => option.id);
        const wrongIds = question.options.filter((option) => !option.correct).map((option) => option.id);
        if (correct) return [question.id, rightIds];
        if (question.kind === 'single') return [question.id, [random.pick(wrongIds)]];
        const dropped = random.pick(rightIds);
        const chosen = rightIds.length > 1 && (random.chance(0.6) || !wrongIds.length) ? rightIds.filter((id) => id !== dropped) : [...rightIds, random.pick(wrongIds)];
        const order = question.options.map((option) => option.id);
        return [question.id, chosen.sort((a, b) => order.indexOf(a) - order.indexOf(b))];
      }),
    );

  /** Which questions to get right for a score as close to `percent` as the quiz allows (same pass or fail). */
  const pickRight = (quiz, percent) => {
    const questions = quiz.questions;
    const max = questions.reduce((sum, question) => sum + question.points, 0);
    const passes = percent >= quiz.passPercent;
    let best = null;
    const count = questions.length;
    if (count <= 16) {
      for (let mask = 0; mask < 1 << count; mask++) {
        const score = questions.reduce((sum, question, index) => sum + (mask & (1 << index) ? question.points : 0), 0);
        const got = max ? Math.round((score / max) * 100) : 0;
        if (got >= quiz.passPercent !== passes) continue;
        const distance = Math.abs(got - percent);
        if (!best || distance < best.distance) best = { mask, distance };
      }
    }
    const mask = best?.mask ?? 0;
    return new Set(questions.filter((_, index) => mask & (1 << index)).map((question) => question.id));
  };

  const submissionsMade = [];
  const addSubmission = (lesson, user, fields) => {
    const id = stableId('submission', lesson.id, user.id);
    const row = {
      id,
      schoolId,
      courseId: lesson.courseId,
      lessonId: lesson.id,
      userId: user.id,
      status: 'draft',
      body: '',
      grade: null,
      feedback: '',
      submittedAt: null,
      gradedAt: null,
      gradedBy: null,
      createdAt: fields.createdAt ?? fields.submittedAt ?? fields.updatedAt,
      updatedAt: fields.updatedAt ?? fields.gradedAt ?? fields.submittedAt,
      ...fields,
    };
    put('submissions', row);
    submissionsMade.push(row);
    return row;
  };

  // The classmates, course by course.
  for (const { course, spec, lessons } of courses) {
    if (course.status === 'draft' || course.publishedAt === null) continue;
    const published = lessons.filter((lesson) => lesson.status === 'published');
    const author = [...people.values()].find((person) => person.id === course.createdBy);
    // A spot in each uploaded video where viewers tend to give up, so its retention curve dips.
    const hardSpots = new Map(published.filter((lesson) => lesson.mediaKey).map((lesson) => [lesson.id, createRandom(`hard/${lesson.id}`).between(0.35, 0.7)]));

    for (const person of classmates) {
      const member = people.get(person.key);
      const random = createRandom(`activity/${spec.slug}/${person.key}`);
      const ability = createRandom(`ability/${person.key}`).between(0.35, 0.95);
      const engagement = random.next();
      const chance = clamp(spec.popularity * (0.55 + 0.9 * ability), 0, 0.97);
      if (!random.chance(chance)) continue;
      const opens = Math.max(course.publishedAt, member.joined) + HOUR;
      const closes = latest - DAY;
      if (opens >= closes) continue;
      const enrolledAt = opens + (closes - opens) * random.next() ** 1.8;
      enroll(course, member, enrolledAt);

      const pace = random.between(0.4, 1.6); // lessons a day
      const dropOff = (0.03 + 0.24 * spec.difficulty) * (1.35 - engagement);
      let at = enrolledAt + random.between(0.5, 6) * HOUR;
      for (const [index, lesson] of published.entries()) {
        if (index > 0 && random.chance(dropOff)) break;
        at = Math.max(at, lesson.publishedAt + random.between(2, 30) * HOUR);
        if (at > latest) break;
        const step = (random.between(0.3, 1.7) / pace) * DAY;

        if (lesson.kind === 'lesson' && lesson.mediaKey && lesson.durationSeconds) {
          const total = segmentCount(lesson.durationSeconds);
          const finishes = random.chance(clamp(0.58 + 0.3 * engagement - 0.25 * spec.difficulty, 0.3, 0.95));
          if (finishes) {
            const segments = range(0, total);
            // Some skip a little (and still pass 90%).
            if (random.chance(0.3) && total >= 10) {
              const skip = random.int(1, Math.max(1, Math.floor(total * 0.08)));
              const from = random.int(1, total - skip - 1);
              segments.splice(from, skip);
            }
            watchedRow(lesson, member, segments, { at, position: random.chance(0.5) ? 0 : lesson.durationSeconds - random.int(1, 4), complete: true });
          } else {
            const hard = hardSpots.get(lesson.id) ?? 0.5;
            const stopAt = random.chance(0.55) ? hard + random.between(-0.06, 0.06) : random.between(0.08, 0.88);
            const stop = clamp(Math.round(total * stopAt), 1, Math.max(1, Math.ceil(total * 0.9) - 2));
            let segments = range(0, stop);
            // A few jumped ahead before giving up.
            if (random.chance(0.2) && stop + 4 < total) segments = [...range(0, Math.max(1, stop - 2)), ...range(stop + 2, Math.min(total, stop + 4))];
            watchedRow(lesson, member, segments, { at, position: Math.max(...segments, 0) * PROGRESS_SEGMENT_SECONDS + random.int(0, 4) });
            // Some leave the video part-way but carry on with the course.
            if (!random.chance(0.55)) break;
          }
        } else if (lesson.kind === 'lesson') {
          if (!random.chance(0.9)) break;
          progressRow(lesson, member, { completedAt: at, updatedAt: at });
        } else if (lesson.kind === 'quiz') {
          const quiz = tables.quizzes.get(lesson.id);
          if (!quiz?.questions.length) continue;
          const limit = quiz.maxAttempts ?? 4;
          let passed = false;
          for (let attempt = 0; attempt < limit; attempt++) {
            if (attempt > 0 && !random.chance(0.75)) break;
            const right = new Set();
            for (const question of quiz.questions) {
              const hardness = createRandom(`question/${question.id}`).between(0.05, 0.45) + 0.25 * spec.difficulty;
              if (random.chance(clamp(ability + 0.3 - hardness + attempt * 0.14, 0.05, 0.97))) right.add(question.id);
            }
            const when = at + attempt * random.between(0.3, 20) * HOUR;
            if (when > latest) break;
            passed = addAttempt(lesson, member, answersFor(quiz.questions, right, random), when);
            if (passed) break;
          }
          if (!passed && !random.chance(0.45)) break;
        } else if (lesson.kind === 'assignment') {
          const assignment = tables.assignments.get(lesson.id);
          const body = ANSWERS.length ? random.pick(ANSWERS) : 'My answer is below.';
          if (random.chance(0.12 + 0.2 * spec.difficulty)) {
            addSubmission(lesson, member, { status: 'draft', body: assignment.allowText ? body : '', createdAt: at, updatedAt: at });
            break;
          }
          const submission = addSubmission(lesson, member, {
            status: 'submitted',
            body: assignment.allowText ? body : '',
            submittedAt: at,
            createdAt: at - random.between(0.5, 30) * HOUR,
            updatedAt: at,
          });
          if (assignment.allowFiles && (!assignment.allowText || random.chance(0.45))) {
            const text = sampleFileText({ studentName: member.name, lessonTitle: lesson.title, body });
            put('files', {
              id: stableId('file', submission.id),
              submissionId: submission.id,
              fileName: `${lesson.key}-${firstName(member.name)
                .toLowerCase()
                .normalize('NFKD')
                .replace(/[^a-z]/g, '')}.md`,
              contentType: 'text/markdown',
              sizeBytes: new TextEncoder().encode(text).length,
              uploaded: true,
              sample: true,
              createdAt: at - 10 * MINUTE,
            });
          }
          progressRow(lesson, member, { completedAt: at, updatedAt: at });
        }
        at += step;
      }
    }

    // Handed-in work: the newest few wait for the author; the rest were graded (a couple returned).
    for (const lesson of published.filter((item) => item.kind === 'assignment')) {
      const assignment = tables.assignments.get(lesson.id);
      const handedIn = submissionsMade.filter((row) => row.lessonId === lesson.id && row.status === 'submitted').sort((a, b) => b.submittedAt - a.submittedAt);
      const waiting = new Set(
        handedIn
          .filter((row) => row.submittedAt > latest - 4 * DAY)
          .slice(0, 3)
          .map((row) => row.id),
      );
      for (const row of handedIn) {
        if (waiting.has(row.id)) continue;
        const random = createRandom(`grade/${row.id}`);
        const gradedAt = Math.min(latest - HOUR, row.submittedAt + random.between(5, 60) * HOUR);
        if (random.chance(0.07)) {
          Object.assign(row, { status: 'returned', grade: null, feedback: random.pick(RETURN_NOTES), gradedAt, gradedBy: author.id, updatedAt: gradedAt });
        } else {
          const ability = createRandom(`ability/${[...people.values()].find((person) => person.id === row.userId).key}`).between(0.35, 0.95);
          const share = clamp(0.5 + 0.45 * ability + random.between(-0.08, 0.08), 0.4, 1);
          const grade = roundGrade(assignment.maxPoints * share, assignment.maxPoints);
          Object.assign(row, { status: 'graded', grade, feedback: FEEDBACK.length ? random.pick(FEEDBACK) : '', gradedAt, gradedBy: author.id, updatedAt: gradedAt });
        }
      }
    }
  }

  // The personas -------------------------------------------------------------------------------------
  for (const [key, entries] of Object.entries(START)) {
    const member = people.get(key);
    if (!member) continue;
    for (const entry of entries) {
      const found = courses.find((item) => item.spec.slug === entry.course);
      if (!found) continue;
      const { course, lessons } = found;
      const random = createRandom(`start/${key}/${entry.course}`);
      const enrolledAt = Math.max(daysAgo(entry.enrolledDaysAgo ?? 7), course.publishedAt ?? 0, member.joined) + HOUR;
      enroll(course, member, enrolledAt);
      const byKey = new Map(lessons.map((lesson) => [lesson.key, lesson]));
      const submissions = entry.submissions ?? {};
      const quizzes = entry.quizzes ?? {};

      // Fixed points in time: work handed in and graded.
      const handedInAt = new Map(
        Object.entries(submissions)
          .filter(([, spec]) => spec.status !== 'draft')
          .map(([lessonKey, spec]) => [
            lessonKey,
            daysAgo(spec.daysAgo ?? 1) - (spec.status === 'graded' || spec.status === 'returned' ? random.between(18, 40) * HOUR : random.between(1, 5) * HOUR),
          ]),
      );
      const done = new Set(entry.completed ?? []);
      for (const [lessonKey, percents] of Object.entries(quizzes)) {
        const quiz = tables.quizzes.get(byKey.get(lessonKey)?.id);
        if (quiz && percents.some((percent) => percent >= quiz.passPercent)) done.add(lessonKey);
      }
      for (const lessonKey of handedInAt.keys()) done.add(lessonKey);

      // Everything else is spread out in outline order between enrolling and now.
      const ordered = lessons.filter((lesson) => done.has(lesson.key) || quizzes[lesson.key] || lesson.key === entry.lastLesson || lesson.key === entry.watching?.lesson);
      const end = Math.min(latest - 3 * HOUR, ...[...handedInAt.values()].map((at) => at - HOUR));
      let at = enrolledAt + random.between(1, 4) * HOUR;
      const span = Math.max(HOUR, end - at);
      for (const [index, lesson] of ordered.entries()) {
        at = Math.max(at + 20 * MINUTE, lesson.publishedAt ? lesson.publishedAt + HOUR : at, enrolledAt + (span * (index + 0.5)) / Math.max(1, ordered.length));
        at = Math.min(at, latest - 2 * HOUR);
        const fixed = handedInAt.get(lesson.key);
        if (lesson.kind === 'quiz' && quizzes[lesson.key]) {
          const quiz = tables.quizzes.get(lesson.id);
          for (const [n, percent] of quizzes[lesson.key].entries()) {
            addAttempt(lesson, member, answersFor(quiz.questions, pickRight(quiz, percent), random), at + n * random.between(1, 26) * HOUR);
          }
        } else if (lesson.kind === 'assignment' && submissions[lesson.key]) {
          const spec = submissions[lesson.key];
          const assignment = tables.assignments.get(lesson.id);
          const submittedAt = fixed ?? null;
          const gradedAt = spec.status === 'graded' || spec.status === 'returned' ? daysAgo(spec.daysAgo ?? 1) - random.between(1, 5) * HOUR : null;
          addSubmission(lesson, member, {
            status: spec.status,
            body: spec.text ?? '',
            grade: spec.status === 'graded' ? (spec.grade ?? assignment.maxPoints) : null,
            feedback: spec.feedback ?? '',
            submittedAt,
            gradedAt,
            gradedBy: gradedAt ? course.createdBy : null,
            createdAt: (submittedAt ?? daysAgo(spec.daysAgo ?? 1)) - random.between(2, 30) * HOUR,
            updatedAt: gradedAt ?? submittedAt ?? daysAgo(spec.daysAgo ?? 1),
          });
          if (submittedAt) progressRow(lesson, member, { completedAt: submittedAt, updatedAt: submittedAt });
        } else if (lesson.kind === 'assignment' && done.has(lesson.key)) {
          const body = ANSWERS[0] ?? 'My answer is below.';
          addSubmission(lesson, member, { status: 'submitted', body, submittedAt: at, createdAt: at - HOUR, updatedAt: at });
          progressRow(lesson, member, { completedAt: at, updatedAt: at });
        } else if (lesson.key === entry.watching?.lesson && !done.has(lesson.key)) {
          const seconds = entry.watching.seconds ?? 0;
          watchedRow(lesson, member, range(0, Math.floor(seconds / PROGRESS_SEGMENT_SECONDS) + 1), { at, position: seconds });
        } else if (done.has(lesson.key)) {
          if (lesson.mediaKey && lesson.durationSeconds) watchedRow(lesson, member, range(0, segmentCount(lesson.durationSeconds)), { at, position: 0, complete: true });
          else progressRow(lesson, member, { completedAt: at, updatedAt: at });
        }
      }
      // Where they were last: the latest activity in the course.
      const last = byKey.get(entry.lastLesson);
      if (last) {
        const touched = latest - random.between(2, 5) * HOUR;
        progressRow(last, member, { updatedAt: touched, createdAt: tables.progress.get(`${last.id}:${member.id}`)?.createdAt ?? touched });
      }
    }
  }

  // Notifications the personas would have had ------------------------------------------------------
  // Everyone starts with the default settings, which show every kind in the app.
  const notify = (user, type, data, at, ref) => {
    put('notifications', {
      id: stableId('notification', user.id, type, ref),
      userId: user.id,
      schoolId,
      type,
      data: { ...data, schoolName: SCHOOL.name },
      createdAt: at,
      // Older ones have been read; the last few days' are new.
      readAt: at < latest - 3.5 * DAY ? at + createRandom(`read/${ref}/${user.id}`).between(0.2, 20) * HOUR : null,
    });
  };
  const school = `/s/${SCHOOL.slug}`;
  const coursePath = (course) => `${school}/c/${course.slug}`;
  const personaMembers = [...personas].map((key) => people.get(key));
  const staffIds = new Set(staffKeys.map(userId));
  for (const { course, lessons } of courses) {
    if (course.publishedAt === null) continue;
    for (const persona of personaMembers) {
      // A course went live: every member but its author.
      if (persona.id !== course.createdBy && persona.joined <= course.publishedAt) {
        notify(
          persona,
          'course.published',
          { title: `New course: ${course.title}`, body: course.summary || `${SCHOOL.name} has a new course.`, path: coursePath(course) },
          course.publishedAt + 2 * MINUTE,
          course.id,
        );
      }
      // New lessons in a live course: its students at the time.
      const enrolled = tables.enrollments.get(`${course.id}:${persona.id}`);
      for (const lesson of lessons) {
        if (!enrolled || persona.id === course.createdBy || !lesson.publishedAt || lesson.publishedAt <= course.publishedAt || enrolled.createdAt > lesson.publishedAt) continue;
        notify(
          persona,
          'lesson.published',
          { title: `New in ${course.title}: ${lesson.title}`, body: lesson.summary, path: `${coursePath(course)}/l/${lesson.id}` },
          lesson.publishedAt + 2 * MINUTE,
          lesson.id,
        );
      }
    }
    // Uploaded videos were processed for their author.
    for (const lesson of lessons.filter((item) => item.mediaKey)) {
      const author = personaMembers.find((persona) => persona.id === course.createdBy);
      if (author)
        notify(
          author,
          'video.processed',
          { title: `Your video for ${lesson.title} is ready`, body: course.title, path: `${coursePath(course)}/edit?lesson=${lesson.id}` },
          lesson.createdAt + 25 * MINUTE,
          lesson.id,
        );
    }
  }
  for (const submission of tables.submissions.values()) {
    const course = tables.courses.get(submission.courseId);
    const lesson = tables.lessons.get(submission.lessonId);
    const student = tables.users.get(submission.userId);
    // Handed in: the course's author (or, without one on the staff, the admins and the owner).
    if (submission.submittedAt) {
      const recipients = staffIds.has(course.createdBy)
        ? [course.createdBy]
        : personaMembers.filter((persona) => ['owner', 'admin'].includes(persona.role)).map((persona) => persona.id);
      for (const persona of personaMembers.filter((item) => recipients.includes(item.id) && item.id !== submission.userId)) {
        notify(
          persona,
          'assignment.submitted',
          { title: `${student.name} handed in ${lesson.title}`, body: course.title, path: `${coursePath(course)}/l/${lesson.id}/submissions/${submission.id}` },
          submission.submittedAt + MINUTE,
          submission.id,
        );
      }
    }
    // Graded or returned: the student.
    const persona = personaMembers.find((item) => item.id === submission.userId);
    if (persona && submission.gradedAt && (submission.status === 'graded' || submission.status === 'returned')) {
      const max = tables.assignments.get(lesson.id).maxPoints;
      const graded = submission.status === 'graded';
      notify(
        persona,
        'assignment.graded',
        {
          title: graded ? `${lesson.title} was graded: ${formatPoints(submission.grade ?? 0)}/${max}` : `${lesson.title} was returned to you`,
          body: graded ? course.title : `Have a look at the feedback in ${course.title} and hand it in again.`,
          path: `${coursePath(course)}/l/${lesson.id}`,
        },
        submission.gradedAt + MINUTE,
        `${submission.id}/graded`,
      );
    }
  }

  // Discussions and live classes ---------------------------------------------------------------------
  // The live classes count from the occurrence's start (the visit's first page load), minute-aligned.
  const liveAnchor = occurrence === null ? anchor : Math.floor(occurrence / MINUTE) * MINUTE;
  const { problems, occurrenceEnds } = social
    ? seedSocial({ social, tables, put, anchor, occurrence: liveAnchor, people, courses, enroll: (course, person, at) => enroll(course, person, at), notify, personaMembers, schoolSlug: SCHOOL.slug })
    : { problems: [], occurrenceEnds: null };

  // Another device each persona is signed in on, and the school's storage ----------------------------
  for (const persona of personaMembers) {
    const random = createRandom(`device/${persona.key}`);
    put('sessions', {
      id: stableId('session', persona.key, 'phone'),
      userId: persona.id,
      userAgent: PHONE_AGENT,
      createdAt: daysAgo(random.between(9, 25)),
      lastUsedAt: latest - random.between(20, 60) * HOUR,
      revokedAt: null,
      refreshToken: null,
    });
  }
  const videoBytes = [...tables.lessons.values()].reduce((sum, lesson) => sum + (lesson.mediaKey && lesson.durationSeconds ? storedBytes(lesson.durationSeconds) : 0), 0);
  const fileBytes = [...tables.files.values()].reduce((sum, file) => sum + file.sizeBytes, 0);
  put('storage', { id: schoolId, quotaBytes: 2 * 1024 ** 3, usedBytes: videoBytes + fileBytes, reservedBytes: 0 });

  return { tables, schoolId, problems, occurrence: liveAnchor, occurrenceEnds };
}

/** The end of that day (17:00 local is when work is usually due), as ms. */
function endOfDay(ms) {
  const date = new Date(ms);
  date.setHours(17, 0, 0, 0);
  return date.getTime();
}

/** A grade as an instructor would give it: whole points, or halves on a larger scale. */
export function roundGrade(value, maxPoints) {
  const step = maxPoints >= 10 ? 0.5 : 1;
  return clamp(Math.round(value / step) * step, 0, maxPoints);
}

/** A right short answer, written as a person might (any accepted answer, any case). */
function rightText(question, random) {
  const answer = random.pick(question.answers.length ? question.answers : ['']);
  return random.chance(0.4) ? answer.charAt(0).toUpperCase() + answer.slice(1) : answer;
}

/** A wrong short answer: a near miss, or a shrug. */
function wrongText(question, random) {
  const accepted = new Set(question.answers.map(normalizeAnswer));
  const base = question.answers[0] ?? '';
  const candidates = [];
  if (/^-?\d+(\.\d+)?$/.test(base.trim())) candidates.push(String(Number(base) + random.int(1, 4)), String(Number(base) * 2));
  if (base.length > 4) candidates.push(base.slice(0, -2));
  candidates.push('not sure', 'I don’t know');
  return candidates.find((text) => !accepted.has(normalizeAnswer(text))) ?? 'not sure';
}

export { reachablePercents };
