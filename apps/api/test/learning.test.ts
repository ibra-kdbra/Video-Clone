import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { TestApi, uniqueSlug } from './helpers.js';

let api: TestApi;
let owner: postgres.Sql;
const s3 = inject('s3');

beforeAll(async () => {
  api = await TestApi.start(
    s3
      ? { S3_ENDPOINT: s3.endpoint, S3_REGION: s3.region, S3_BUCKET: s3.bucket, S3_ACCESS_KEY_ID: s3.accessKeyId, S3_SECRET_ACCESS_KEY: s3.secretAccessKey }
      : {},
  );
  owner = postgres(inject('ownerDatabaseUrl'), { max: 1, onnotice: () => {} });
});
afterAll(async () => {
  await api.close();
  await owner.end();
});

type Person = Awaited<ReturnType<TestApi['signup']>>;

/**
 * A published course with a 60-second uploaded video lesson (made ready straight in the
 * database), a text lesson, a quiz and an assignment, and two enrolled students.
 */
async function course() {
  const people = {
    head: await api.signup('Head'),
    author: await api.signup('Author'),
    student: await api.signup('Student'),
    other: await api.signup('Other student'),
    outsider: await api.signup('Not enrolled'),
  };
  const school = await api.createSchool(people.head.token, uniqueSlug(), 'Learning School');
  for (const [person, role] of [[people.author, 'instructor'], [people.student, 'student'], [people.other, 'student'], [people.outsider, 'student']] as const) {
    await owner`insert into memberships (school_id, user_id, role) values (${school.id}, ${person.user.id}, ${role})`;
  }
  const base = `/schools/${school.slug}/courses`;
  const as = (person: Person) => ({
    get: (path: string) => api.request('GET', path, { token: person.token }),
    post: (path: string, body?: unknown) => api.request('POST', path, { token: person.token, body }),
    put: (path: string, body?: unknown) => api.request('PUT', path, { token: person.token, body }),
    patch: (path: string, body?: unknown) => api.request('PATCH', path, { token: person.token, body }),
    del: (path: string) => api.request('DELETE', path, { token: person.token }),
  });
  const author = as(people.author);
  const { body: created } = await author.post(base, { title: 'Learning Course' });
  const url = `${base}/${created.slug}`;
  const moduleId = created.modules[0].id;
  const lesson = async (title: string, kind: string) => {
    const { body } = await author.post(`${url}/lessons`, { moduleId, title, kind });
    await author.patch(`${url}/lessons/${body.id}`, { status: 'published' });
    return body.id as string;
  };
  const video = await lesson('Watch this', 'lesson');
  const text = await lesson('Read this', 'lesson');
  const quiz = await lesson('Check yourself', 'quiz');
  const assignment = await lesson('Hand this in', 'assignment');
  const [asset] = await owner<{ id: string }[]>`
    insert into media_assets (school_id, status, file_name, content_type, declared_bytes, duration_seconds, progress)
    values (${school.id}, 'ready', 'v.mp4', 'video/mp4', 1, 60, 100) returning id`;
  await owner`update lessons set video_provider = 'upload', media_id = ${asset!.id}, duration_seconds = 60 where id = ${video}`;
  await author.patch(url, { status: 'published' });
  await as(people.student).post(`${url}/enrollment`);
  await as(people.other).post(`${url}/enrollment`);
  return { ...people, school, url, as, lessons: { video, text, quiz, assignment } };
}

const range = (from: number, to: number) => Array.from({ length: to - from }, (_, index) => from + index);

describe('lessons of different kinds', () => {
  it('creates quizzes and assignments with their settings, and keeps videos off them', async () => {
    const { as, author, url, lessons, student } = await course();
    const outline = (await as(student).get(url)).body;
    expect(outline.modules[0].lessons.map((lesson: { kind: string }) => lesson.kind)).toEqual(['lesson', 'lesson', 'quiz', 'assignment']);
    expect((await as(author).get(`${url}/lessons/${lessons.quiz}/quiz/draft`)).body).toMatchObject({ passPercent: 70, maxAttempts: null, questions: [] });
    expect((await as(author).get(`${url}/lessons/${lessons.assignment}/assignment`)).body).toMatchObject({ maxPoints: 100, allowText: true, allowFiles: true });
    const embed = await as(author).patch(`${url}/lessons/${lessons.quiz}`, { video: { provider: 'youtube', ref: 'dQw4w9WgXcQ' } });
    expect(embed.status).toBe(409);
  });

  it('announces a lesson published in a published course, but not one in a draft', async () => {
    const { as, author, url } = await course();
    const { body: created } = await as(author).get(url);
    const { body: lesson } = await as(author).post(`${url}/lessons`, { moduleId: created.modules[0].id, title: 'New one' });
    await as(author).patch(`${url}/lessons/${lesson.id}`, { status: 'published' });
    const events = await owner`select payload from outbox where type = 'lesson.published' and payload->>'lessonId' = ${lesson.id}`;
    expect(events).toHaveLength(1);
    expect(events[0]!.payload).toMatchObject({ courseId: created.id, actorId: author.user.id });
  });
});

describe('watch progress', () => {
  it('counts each stretch once, keeps the position, and completes the lesson at 90%', async () => {
    const { as, student, url, lessons } = await course();
    const progress = (segments: number[], positionSeconds = 0) => as(student).put(`${url}/lessons/${lessons.video}/progress`, { segments, positionSeconds });

    expect((await progress(range(0, 6), 30)).body).toMatchObject({ completed: false, percent: 50, positionSeconds: 30 });
    // The same stretches again, and some past the end, change nothing.
    expect((await progress([0, 1, 2, 9999 - 9990 + 20], 31)).body).toMatchObject({ percent: 50, positionSeconds: 31 });
    expect((await progress(range(6, 10), 50)).body).toMatchObject({ completed: false, percent: 83 });
    const done = await progress([10], 55);
    expect(done.body).toMatchObject({ completed: true, percent: 100 });
    // Once completed, always completed.
    expect((await progress([], 5)).body).toMatchObject({ completed: true, positionSeconds: 5 });

    const lesson = (await as(student).get(`${url}/lessons/${lessons.video}`)).body;
    expect(lesson.progress).toEqual({ completed: true, percent: 100 });
    expect(lesson.progressDetail).toMatchObject({ completed: true, positionSeconds: 5 });
  });

  it('records progress for enrolled students only, and checks what the player sends', async () => {
    const { as, author, outsider, student, url, lessons } = await course();
    const body = { segments: [0], positionSeconds: 1 };
    expect((await as(outsider).put(`${url}/lessons/${lessons.video}/progress`, body)).status).toBe(403);
    expect((await as(author).put(`${url}/lessons/${lessons.video}/progress`, body)).status).toBe(403);
    expect((await as(student).put(`${url}/lessons/${lessons.quiz}/progress`, body)).status).toBe(409);
    expect((await as(student).put(`${url}/lessons/${lessons.video}/progress`, { segments: [-1], positionSeconds: 1 })).status).toBe(400);
    expect((await as(student).put(`${url}/lessons/${lessons.video}/progress`, { segments: range(0, 721), positionSeconds: 1 })).status).toBe(400);
    expect((await as(author).get(`${url}/lessons/${lessons.video}`)).body.progressDetail).toBeNull();
  });

  it('lets a lesson without an uploaded video be marked done by hand, and no other', async () => {
    const { as, student, url, lessons } = await course();
    expect((await as(student).post(`${url}/lessons/${lessons.text}/complete`)).body).toMatchObject({ completed: true, percent: 100 });
    expect((await as(student).post(`${url}/lessons/${lessons.video}/complete`)).status).toBe(409);
    expect((await as(student).post(`${url}/lessons/${lessons.quiz}/complete`)).status).toBe(409);
  });

  it('shows course progress in the course, the catalog and the student list', async () => {
    const { as, author, student, url, lessons, school } = await course();
    await as(student).post(`${url}/lessons/${lessons.text}/complete`);
    await as(student).put(`${url}/lessons/${lessons.video}/progress`, { segments: [0, 1], positionSeconds: 9 });

    const view = (await as(student).get(url)).body;
    expect(view.progress).toMatchObject({ completedLessons: 1, totalLessons: 4, percent: 25, lastLessonId: lessons.video });
    const byId = Object.fromEntries(view.modules[0].lessons.map((lesson: { id: string; progress: unknown }) => [lesson.id, lesson.progress]));
    expect(byId[lessons.text]).toEqual({ completed: true, percent: 100 });
    expect(byId[lessons.video]).toEqual({ completed: false, percent: 16 });
    expect(byId[lessons.quiz]).toEqual({ completed: false, percent: 0 });

    const catalog = (await as(student).get(`/schools/${school.slug}/courses`)).body;
    expect(catalog[0].progress).toMatchObject({ completedLessons: 1, totalLessons: 4, percent: 25, lastLessonId: lessons.video });
    expect((await as(author).get(url)).body.progress).toBeNull();

    const students = (await as(author).get(`${url}/enrollments`)).body;
    expect(students.find((row: { userId: string }) => row.userId === student.user.id).progress).toMatchObject({ completedLessons: 1, totalLessons: 4, percent: 25 });
  });
});

describe('quizzes', () => {
  const questions = [
    { kind: 'single', prompt: 'Which note is middle C?', explanation: 'C4 is middle C.', points: 2, options: [{ label: 'C4', correct: true }, { label: 'C5', correct: false }] },
    { kind: 'multiple', prompt: 'Which are white keys?', options: [{ label: 'C', correct: true }, { label: 'E', correct: true }, { label: 'C sharp', correct: false }] },
    { kind: 'short', prompt: 'How many keys has a full piano?', answers: ['88', 'eighty-eight'] },
  ];

  async function withQuiz(maxAttempts: number | null = 2) {
    const setup = await course();
    const quizUrl = `${setup.url}/lessons/${setup.lessons.quiz}/quiz`;
    const saved = await setup.as(setup.author).put(quizUrl, { passPercent: 75, maxAttempts, questions });
    expect(saved.status).toBe(200);
    return { ...setup, quizUrl, draft: saved.body };
  }

  it('checks questions before saving them', async () => {
    const { as, author, url, lessons } = await course();
    const save = (question: unknown) => as(author).put(`${url}/lessons/${lessons.quiz}/quiz`, { passPercent: 70, maxAttempts: null, questions: [question] });
    expect((await save({ kind: 'single', prompt: 'Two right?', options: [{ label: 'a', correct: true }, { label: 'b', correct: true }] })).status).toBe(400);
    expect((await save({ kind: 'multiple', prompt: 'None right?', options: [{ label: 'a', correct: false }, { label: 'b', correct: false }] })).status).toBe(400);
    expect((await save({ kind: 'short', prompt: 'No answer?', answers: [] })).status).toBe(400);
    expect((await save({ kind: 'single', prompt: 'One choice?', options: [{ label: 'a', correct: true }] })).status).toBe(400);
  });

  it('shows takers the questions without the answers, and editors everything', async () => {
    const { as, student, other, quizUrl, draft } = await withQuiz();
    expect(draft.questions[0].options[0]).toMatchObject({ label: 'C4', correct: true });
    expect(draft.questions[2].answers).toEqual(['88', 'eighty-eight']);
    const quiz = (await as(student).get(quizUrl)).body;
    expect(quiz).toMatchObject({ passPercent: 75, maxAttempts: 2, maxScore: 4, attempts: [], attemptsLeft: 2, passed: false, bestPercent: null });
    expect(JSON.stringify(quiz)).not.toMatch(/correct|answers|explanation|eighty/);
    expect((await as(other).get(`${quizUrl}/draft`)).status).toBe(403);
  });

  it('grades attempts, reveals answers only once passed or out of attempts, and completes the lesson on a pass', async () => {
    const { as, student, url, lessons, quizUrl, draft } = await withQuiz();
    const [single, multiple, short] = draft.questions;
    const right = { [single.id]: [single.options[0].id], [multiple.id]: [multiple.options[0].id, multiple.options[1].id], [short.id]: ' Eighty-Eight ' };

    const wrong = await as(student).post(`${quizUrl}/attempts`, { answers: { ...right, [single.id]: [single.options[1].id] } });
    expect(wrong.body).toMatchObject({ score: 2, maxScore: 4, percent: 50, passed: false, attemptsLeft: 1 });
    expect(wrong.body.questions.map((question: { correct: boolean }) => question.correct)).toEqual([false, true, true]);
    expect(wrong.body.questions[0]).toMatchObject({ explanation: null, correctOptionIds: null });
    expect((await as(student).get(`${url}/lessons/${lessons.quiz}`)).body.progress.completed).toBe(false);

    const passed = await as(student).post(`${quizUrl}/attempts`, { answers: right });
    expect(passed.body).toMatchObject({ percent: 100, passed: true, attemptsLeft: 0 });
    expect(passed.body.questions[0]).toMatchObject({ explanation: 'C4 is middle C.', correctOptionIds: [single.options[0].id] });
    expect(passed.body.questions[2].acceptedAnswers).toEqual(['88', 'eighty-eight']);
    expect((await as(student).get(`${url}/lessons/${lessons.quiz}`)).body.progress.completed).toBe(true);

    expect((await as(student).post(`${quizUrl}/attempts`, { answers: right })).body.error.code).toBe('limit_reached');
    expect((await as(student).get(quizUrl)).body).toMatchObject({ passed: true, bestPercent: 100, attemptsLeft: 0 });
  });

  it('keeps to the attempt limit when attempts arrive at once', async () => {
    const { as, student, quizUrl } = await withQuiz(1);
    const results = await Promise.all(Array.from({ length: 4 }, () => as(student).post(`${quizUrl}/attempts`, { answers: {} })));
    expect(results.map((result) => result.status).sort()).toEqual([201, 403, 403, 403]);
    const [attempts] = await owner`select count(*)::int as n from quiz_attempts where user_id = ${student.user.id}`;
    expect(attempts!.n).toBe(1);
  });

  it('lets only enrolled students make attempts, and refuses an empty quiz', async () => {
    const { as, author, outsider, quizUrl } = await withQuiz();
    expect((await as(outsider).post(`${quizUrl}/attempts`, { answers: {} })).status).toBe(403);
    expect((await as(author).post(`${quizUrl}/attempts`, { answers: {} })).status).toBe(403);
    const empty = await course();
    expect((await empty.as(empty.student).post(`${empty.url}/lessons/${empty.lessons.quiz}/quiz/attempts`, { answers: {} })).status).toBe(409);
  });

  it('keeps past scores when the quiz changes', async () => {
    const { as, author, student, quizUrl, draft } = await withQuiz();
    await as(student).post(`${quizUrl}/attempts`, { answers: {} });
    const edited = await as(author).put(quizUrl, { passPercent: 50, maxAttempts: null, questions: [{ ...questions[0], id: draft.questions[0].id }] });
    expect(edited.body).toMatchObject({ attemptCount: 1, questions: [{ id: draft.questions[0].id }] });
    expect((await as(student).get(quizUrl)).body.attempts[0]).toMatchObject({ score: 0, maxScore: 4 });
  });
});

describe.skipIf(!s3)('assignments', () => {
  const upload = async (url: string, contentType: string, body: string) => (await fetch(url, { method: 'PUT', headers: { 'content-type': contentType }, body })).status;
  const quota = async (schoolId: string) =>
    (await owner<{ used: number; reserved: number }[]>`select used_bytes::int as used, reserved_bytes::int as reserved from school_storage where school_id = ${schoolId}`)[0]!;

  it('takes a written answer and files, hands them in, and completes the lesson', async () => {
    const { as, student, school, url, lessons } = await course();
    const a = `${url}/lessons/${lessons.assignment}/assignment`;
    expect((await as(student).post(`${a}/submission/submit`)).status).toBe(400);
    expect((await as(student).put(`${a}/submission`, { body: 'My essay.' })).body).toMatchObject({ status: 'draft', body: 'My essay.' });

    const ticket = (await as(student).post(`${a}/submission/files`, { fileName: 'essay.pdf', size: 9, contentType: 'application/pdf' })).body;
    expect(await quota(school.id)).toEqual({ used: 0, reserved: 9 });
    expect(await upload(ticket.url, 'text/html', '<script>')).toBe(403);
    expect(await upload(ticket.url, 'application/pdf', '%PDF-1.4!')).toBe(200);
    const withFile = (await as(student).post(`${a}/submission/files/${ticket.file.id}/complete`)).body;
    expect(withFile.files).toEqual([expect.objectContaining({ fileName: 'essay.pdf', sizeBytes: 9, uploaded: true })]);
    expect(await quota(school.id)).toEqual({ used: 9, reserved: 0 });

    const handedIn = (await as(student).post(`${a}/submission/submit`)).body;
    expect(handedIn).toMatchObject({ status: 'submitted' });
    expect(handedIn.submittedAt).toBeTruthy();
    expect((await as(student).get(`${url}/lessons/${lessons.assignment}`)).body.progress.completed).toBe(true);
    expect((await as(student).put(`${a}/submission`, { body: 'Changed my mind' })).status).toBe(409);
    expect(await owner`select 1 from outbox where type = 'assignment.submitted' and payload->>'submissionId' = ${handedIn.id}`).toHaveLength(1);
  });

  it('frees the space of a file that is removed, or arrives at the wrong size', async () => {
    const { as, student, school, url, lessons } = await course();
    const a = `${url}/lessons/${lessons.assignment}/assignment`;
    const wrong = (await as(student).post(`${a}/submission/files`, { fileName: 'notes.txt', size: 100, contentType: 'text/plain' })).body;
    await upload(wrong.url, 'text/plain', 'short');
    expect((await as(student).post(`${a}/submission/files/${wrong.file.id}/complete`)).status).toBe(400);
    expect(await quota(school.id)).toEqual({ used: 0, reserved: 0 });

    const kept = (await as(student).post(`${a}/submission/files`, { fileName: 'notes.txt', size: 5, contentType: 'text/plain' })).body;
    await upload(kept.url, 'text/plain', 'hello');
    await as(student).post(`${a}/submission/files/${kept.file.id}/complete`);
    expect((await as(student).del(`${a}/submission/files/${kept.file.id}`)).body.files).toEqual([]);
    expect(await quota(school.id)).toEqual({ used: 0, reserved: 0 });
    expect((await as(student).post(`${a}/submission/files`, { fileName: 'x.exe', size: 5, contentType: 'application/x-msdownload' })).status).toBe(400);
  });

  it("lets editors list, read, download, return and grade submissions, and nobody else see a student's files", async () => {
    const { as, author, student, other, url, lessons } = await course();
    const a = `${url}/lessons/${lessons.assignment}/assignment`;
    const ticket = (await as(student).post(`${a}/submission/files`, { fileName: 'scales.txt', size: 5, contentType: 'text/plain' })).body;
    await upload(ticket.url, 'text/plain', 'C D E');
    await as(student).post(`${a}/submission/files/${ticket.file.id}/complete`);
    const { body: handedIn } = await as(student).post(`${a}/submission/submit`);

    const list = (await as(author).get(`${a}/submissions`)).body;
    expect(list).toEqual([expect.objectContaining({ id: handedIn.id, status: 'submitted', fileCount: 1, student: expect.objectContaining({ name: 'Student' }) })]);
    expect((await as(author).get(`${a}`)).body.counts).toEqual({ submitted: 1, graded: 0, returned: 0 });
    expect((await as(student).get(`${a}/submissions`)).status).toBe(403);

    const fileUrl = `${a}/submissions/${handedIn.id}/files/${ticket.file.id}`;
    const download = (await as(author).get(fileUrl)).body;
    const file = await fetch(download.url);
    expect(file.headers.get('content-disposition')).toMatch(/^attachment; filename="scales.txt"/);
    expect(await file.text()).toBe('C D E');
    expect((await as(student).get(fileUrl)).status).toBe(200);
    expect((await as(other).get(fileUrl)).status).toBe(404);

    const grade = (body: unknown) => as(author).post(`${a}/submissions/${handedIn.id}/grade`, body);
    expect((await grade({ status: 'graded', grade: 101, feedback: '' })).status).toBe(400);
    expect((await grade({ status: 'graded', grade: null, feedback: '' })).status).toBe(400);
    expect((await grade({ status: 'returned', grade: null, feedback: 'Add the B.' })).body).toMatchObject({ status: 'returned', feedback: 'Add the B.' });
    expect((await as(student).put(`${a}/submission`, { body: 'Now with B' })).body.status).toBe('returned');
    await as(student).post(`${a}/submission/submit`);
    expect((await grade({ status: 'graded', grade: 92.5, feedback: 'Lovely.' })).body).toMatchObject({ status: 'graded', grade: 92.5 });
    expect((await as(student).get(a)).body.submission).toMatchObject({ status: 'graded', grade: 92.5, feedback: 'Lovely.' });
    const graded = await owner`select payload from outbox where type = 'assignment.graded' and payload->>'submissionId' = ${handedIn.id} order by id`;
    expect(graded.map((event) => event.payload.status)).toEqual(['returned', 'graded']);
  });

  it('clears away handed-in files when their lesson is deleted', async () => {
    const { as, author, student, url, lessons, school } = await course();
    const a = `${url}/lessons/${lessons.assignment}/assignment`;
    const ticket = (await as(student).post(`${a}/submission/files`, { fileName: 'gone.txt', size: 4, contentType: 'text/plain' })).body;
    await upload(ticket.url, 'text/plain', 'gone');
    await as(student).post(`${a}/submission/files/${ticket.file.id}/complete`);
    expect((await as(author).del(`${url}/lessons/${lessons.assignment}`)).status).toBe(204);
    const [event] = await owner`select payload from outbox where type = 'files.deleted' and school_id = ${school.id}`;
    expect(event!.payload.files).toEqual([{ key: expect.stringContaining(`/${ticket.file.id}`), bytes: 4, uploaded: true }]);
  });
});

describe('insights', () => {
  it('shows editors activity, completion, where students stop watching, and how questions are answered', async () => {
    const { as, author, student, other, url, lessons } = await course();
    const quizUrl = `${url}/lessons/${lessons.quiz}/quiz`;
    const { body: draft } = await as(author).put(quizUrl, {
      passPercent: 100,
      maxAttempts: null,
      questions: [{ kind: 'single', prompt: 'Pick A', options: [{ label: 'A', correct: true }, { label: 'B', correct: false }] }],
    });
    const [question] = draft.questions;
    await as(student).put(`${url}/lessons/${lessons.video}/progress`, { segments: range(0, 12), positionSeconds: 60 });
    await as(other).put(`${url}/lessons/${lessons.video}/progress`, { segments: range(0, 3), positionSeconds: 15 });
    await as(student).post(`${quizUrl}/attempts`, { answers: { [question.id]: [question.options[1].id] } });
    await as(student).post(`${quizUrl}/attempts`, { answers: { [question.id]: [question.options[0].id] } });
    await as(other).post(`${quizUrl}/attempts`, { answers: {} });

    const insights = (await as(author).get(`${url}/insights`)).body;
    expect(insights).toMatchObject({ enrolled: 2, activeLast7Days: 2, completedCourse: 0 });
    const byId = Object.fromEntries(insights.lessons.map((lesson: { lessonId: string }) => [lesson.lessonId, lesson]));
    expect(byId[lessons.video]).toMatchObject({ started: 2, completed: 1, completionRate: 50, averageWatchedPercent: 63 });
    expect(byId[lessons.quiz]).toMatchObject({ completed: 1, quiz: { students: 2, attempts: 3, passRate: 50, averageBestPercent: 50 } });
    expect(byId[lessons.assignment].assignment).toEqual({ submitted: 0, graded: 0, averageGrade: null, maxPoints: 100 });

    const retention = (await as(author).get(`${url}/lessons/${lessons.video}/insights`)).body.retention;
    expect(retention).toMatchObject({ segmentSeconds: 5, viewers: 2 });
    expect(retention.counts).toEqual([2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
    const answers = (await as(author).get(`${url}/lessons/${lessons.quiz}/insights`)).body.questions;
    expect(answers).toEqual([{ id: question.id, prompt: 'Pick A', answered: 3, correctRate: 33 }]);

    expect((await as(student).get(`${url}/insights`)).status).toBe(403);
  });
});
