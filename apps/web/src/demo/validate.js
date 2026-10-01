import {
  EMBED_PROVIDERS,
  EMBED_REF_FORMAT,
  LESSON_KINDS,
  ROLE_RANK,
  ROLES,
  assignmentInput,
  courseSlug,
  courseTitle,
  displayName,
  email,
  plainText,
  quizInput,
  schoolName,
  schoolSlug,
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
