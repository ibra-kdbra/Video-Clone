import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { TestApi, uniqueSlug } from './helpers.js';

let api: TestApi;
let owner: postgres.Sql;
beforeAll(async () => {
  api = await TestApi.start();
  owner = postgres(inject('ownerDatabaseUrl'), { max: 1, onnotice: () => {} });
});
afterAll(async () => {
  await api.close();
  await owner.end();
});

type Person = Awaited<ReturnType<TestApi['signup']>>;

/** A school with an owner, two instructors and two students (added straight to the database). */
async function school() {
  const people = {
    owner: await api.signup('Owner'),
    author: await api.signup('Author'),
    colleague: await api.signup('Colleague'),
    student: await api.signup('Student'),
    other: await api.signup('Other student'),
  };
  const created = await api.createSchool(people.owner.token, uniqueSlug(), 'Course School');
  const add = (person: Person, role: string) =>
    owner`insert into memberships (school_id, user_id, role) values (${created.id}, ${person.user.id}, ${role})`;
  await add(people.author, 'instructor');
  await add(people.colleague, 'instructor');
  await add(people.student, 'student');
  await add(people.other, 'student');
  const base = `/schools/${created.slug}/courses`;
  return { ...people, school: created, base };
}

describe('courses', () => {
  it('lets instructors create courses, with an address from the title and a first module', async () => {
    const { author, student, base } = await school();
    const course = await api.request('POST', base, { token: author.token, body: { title: 'Música & Rhythm', summary: 'Feel the beat.' } });
    expect(course.status).toBe(201);
    expect(course.body).toMatchObject({ slug: 'musica-rhythm', status: 'draft', canEdit: true, lessonCount: 0, createdBy: { name: 'Author' } });
    expect(course.body.modules).toEqual([expect.objectContaining({ title: 'Module 1', lessons: [] })]);

    const again = await api.request('POST', base, { token: author.token, body: { title: 'Música & Rhythm' } });
    expect(again.body.slug).toBe('musica-rhythm-2');
    expect((await api.request('POST', base, { token: student.token, body: { title: 'Nope' } })).status).toBe(403);
  });

  it('shows drafts only to their author and admins, and published courses to everyone', async () => {
    const { owner: head, author, colleague, student, base } = await school();
    const { body: course } = await api.request('POST', base, { token: author.token, body: { title: 'Draft course' } });
    const titles = async (person: Person) => (await api.request('GET', base, { token: person.token })).body.map((item: { title: string }) => item.title);

    expect(await titles(author)).toEqual(['Draft course']);
    expect(await titles(head)).toEqual(['Draft course']);
    expect(await titles(colleague)).toEqual([]);
    expect(await titles(student)).toEqual([]);
    expect((await api.request('GET', `${base}/${course.slug}`, { token: student.token })).status).toBe(404);

    await api.request('PATCH', `${base}/${course.slug}`, { token: author.token, body: { status: 'published' } });
    expect(await titles(student)).toEqual(['Draft course']);
    const published = await api.request('GET', `${base}/${course.slug}`, { token: student.token });
    expect(published.body).toMatchObject({ status: 'published', canEdit: false });
    expect(published.body.publishedAt).toBeTruthy();
  });

  it('lets only the author and admins change a course', async () => {
    const { owner: head, author, colleague, base } = await school();
    const { body: course } = await api.request('POST', base, { token: author.token, body: { title: 'Owned course' } });
    await api.request('PATCH', `${base}/${course.slug}`, { token: author.token, body: { status: 'published' } });

    expect((await api.request('PATCH', `${base}/${course.slug}`, { token: colleague.token, body: { title: 'Mine now' } })).status).toBe(403);
    expect((await api.request('PATCH', `${base}/${course.slug}`, { token: head.token, body: { summary: 'Edited by the owner' } })).body.summary).toBe('Edited by the owner');
    expect((await api.request('DELETE', `${base}/${course.slug}`, { token: colleague.token })).status).toBe(403);
  });

  it('refuses an address another course uses, and empty updates', async () => {
    const { author, base } = await school();
    await api.request('POST', base, { token: author.token, body: { title: 'First', slug: 'first-course' } });
    const { body: second } = await api.request('POST', base, { token: author.token, body: { title: 'Second' } });
    const clash = await api.request('PATCH', `${base}/${second.slug}`, { token: author.token, body: { slug: 'first-course' } });
    expect(clash.status).toBe(409);
    expect(clash.body.error.code).toBe('slug_taken');
    expect((await api.request('PATCH', `${base}/${second.slug}`, { token: author.token, body: {} })).status).toBe(400);
  });
});

describe('outline', () => {
  async function courseWithLessons() {
    const context = await school();
    const { body: course } = await api.request('POST', context.base, { token: context.author.token, body: { title: 'Outline course' } });
    const url = `${context.base}/${course.slug}`;
    const { body: withSecond } = await api.request('POST', `${url}/modules`, { token: context.author.token, body: { title: 'Module 2' } });
    const [first, second] = withSecond.modules;
    const lesson = async (moduleId: string, title: string) =>
      (await api.request('POST', `${url}/lessons`, { token: context.author.token, body: { moduleId, title } })).body;
    const a = await lesson(first.id, 'A');
    const b = await lesson(first.id, 'B');
    const c = await lesson(second.id, 'C');
    return { ...context, course, url, first, second, a, b, c };
  }

  it('adds modules and lessons in order', async () => {
    const { author, url } = await courseWithLessons();
    const { body } = await api.request('GET', url, { token: author.token });
    expect(body.modules.map((module: { title: string; lessons: { title: string }[] }) => [module.title, module.lessons.map((lesson) => lesson.title)])).toEqual([
      ['Module 1', ['A', 'B']],
      ['Module 2', ['C']],
    ]);
  });

  it('reorders modules and moves lessons between them in one request', async () => {
    const { author, url, first, second, a, b, c } = await courseWithLessons();
    const reordered = await api.request('PUT', `${url}/outline`, {
      token: author.token,
      body: { modules: [{ id: second.id, lessonIds: [b.id, c.id] }, { id: first.id, lessonIds: [a.id] }] },
    });
    expect(reordered.status).toBe(200);
    expect(reordered.body.modules.map((module: { lessons: { title: string }[] }) => module.lessons.map((lesson) => lesson.title))).toEqual([['B', 'C'], ['A']]);

    const incomplete = await api.request('PUT', `${url}/outline`, { token: author.token, body: { modules: [{ id: first.id, lessonIds: [a.id] }] } });
    expect(incomplete.status).toBe(409);
  });

  it('renames and deletes modules, but always keeps one', async () => {
    const { author, url, first, second } = await courseWithLessons();
    expect((await api.request('PATCH', `${url}/modules/${first.id}`, { token: author.token, body: { title: 'Basics' } })).body.modules[0].title).toBe('Basics');
    const { body } = await api.request('DELETE', `${url}/modules/${second.id}`, { token: author.token });
    expect(body.modules).toHaveLength(1);
    expect((await api.request('DELETE', `${url}/modules/${first.id}`, { token: author.token })).status).toBe(409);
  });

  it('shows students only published lessons, and lets them watch only once enrolled (or a preview)', async () => {
    const { author, student, url, a, b, c } = await courseWithLessons();
    await api.request('PATCH', url, { token: author.token, body: { status: 'published' } });
    await api.request('PATCH', `${url}/lessons/${a.id}`, { token: author.token, body: { status: 'published', notes: '# Welcome', isPreview: true } });
    await api.request('PATCH', `${url}/lessons/${b.id}`, { token: author.token, body: { status: 'published', video: { provider: 'youtube', ref: 'dQw4w9WgXcQ', durationSeconds: 212 } } });

    const { body: course } = await api.request('GET', url, { token: student.token });
    expect(course.modules).toHaveLength(1);
    expect(course.modules[0].lessons.map((lesson: { title: string; locked: boolean }) => [lesson.title, lesson.locked])).toEqual([
      ['A', false],
      ['B', true],
    ]);
    expect(course.durationSeconds).toBe(212);

    expect((await api.request('GET', `${url}/lessons/${a.id}`, { token: student.token })).body.notes).toBe('# Welcome');
    const locked = await api.request('GET', `${url}/lessons/${b.id}`, { token: student.token });
    expect(locked.status).toBe(403);
    expect(locked.body.error.code).toBe('enrollment_required');
    expect((await api.request('GET', `${url}/lessons/${c.id}`, { token: student.token })).status).toBe(404);

    expect((await api.request('POST', `${url}/enrollment`, { token: student.token })).status).toBe(204);
    const lesson = await api.request('GET', `${url}/lessons/${b.id}`, { token: student.token });
    expect(lesson.body).toMatchObject({ video: { provider: 'youtube', ref: 'dQw4w9WgXcQ' }, previous: { title: 'A' }, next: null });
    const playback = await api.request('GET', `${url}/lessons/${b.id}/playback`, { token: student.token });
    expect(playback.body).toEqual({ kind: 'embed', provider: 'youtube', ref: 'dQw4w9WgXcQ' });
  });

  it('checks platform video ids', async () => {
    const { author, url, a } = await courseWithLessons();
    const bad = await api.request('PATCH', `${url}/lessons/${a.id}`, { token: author.token, body: { video: { provider: 'youtube', ref: 'not a video' } } });
    expect(bad.status).toBe(400);
    expect(bad.body.error.details[0].path).toBe('video.ref');
    const twitch = await api.request('PATCH', `${url}/lessons/${a.id}`, { token: author.token, body: { video: { provider: 'twitch', ref: 'AwkwardHelplessSalamanderSwiftRage' } } });
    expect(twitch.body.video).toEqual({ provider: 'twitch', ref: 'AwkwardHelplessSalamanderSwiftRage' });
    const removed = await api.request('PATCH', `${url}/lessons/${a.id}`, { token: author.token, body: { video: null } });
    expect(removed.body.video).toBeNull();
  });
});

describe('enrollment', () => {
  it("can't enroll in a draft, and leaving the school ends enrollments", async () => {
    const { owner: head, author, student, school: created, base } = await school();
    const { body: course } = await api.request('POST', base, { token: author.token, body: { title: 'Enroll course' } });
    const url = `${base}/${course.slug}`;
    expect((await api.request('POST', `${url}/enrollment`, { token: student.token })).status).toBe(404);
    await api.request('PATCH', url, { token: author.token, body: { status: 'published' } });
    expect((await api.request('POST', `${url}/enrollment`, { token: student.token })).status).toBe(204);
    expect((await api.request('POST', `${url}/enrollment`, { token: student.token })).status).toBe(204);

    const mine = await api.request('GET', `${base}?mine=true`, { token: student.token });
    expect(mine.body.map((item: { slug: string; enrolled: boolean }) => [item.slug, item.enrolled])).toEqual([[course.slug, true]]);
    const roster = await api.request('GET', `${url}/enrollments`, { token: author.token });
    expect(roster.body.map((entry: { userId: string }) => entry.userId)).toEqual([student.user.id]);
    expect((await api.request('GET', `${url}/enrollments`, { token: student.token })).status).toBe(403);

    await api.request('DELETE', `/schools/${created.slug}/members/${student.user.id}`, { token: head.token });
    const [left] = await owner`select count(*)::int as total from enrollments where user_id = ${student.user.id}`;
    expect(left!.total).toBe(0);
  });
});

describe('deleting', () => {
  it('deletes a course with its outline and queues its videos for removal', async () => {
    const { author, base, school: created } = await school();
    const { body: course } = await api.request('POST', base, { token: author.token, body: { title: 'Doomed course' } });
    const url = `${base}/${course.slug}`;
    const { body: lesson } = await api.request('POST', `${url}/lessons`, { token: author.token, body: { moduleId: course.modules[0].id, title: 'L' } });
    // A finished upload, as the worker would leave it.
    const [asset] = await owner<{ id: string }[]>`
      insert into media_assets (school_id, status, file_name, content_type, declared_bytes, stored_bytes)
      values (${created.id}, 'ready', 'a.mp4', 'video/mp4', 10, 10) returning id`;
    await owner`update lessons set video_provider = 'upload', media_id = ${asset!.id} where id = ${lesson.id}`;

    expect((await api.request('DELETE', url, { token: author.token })).status).toBe(204);
    expect((await api.request('GET', url, { token: author.token })).status).toBe(404);
    const events = await owner`select payload from outbox where type = 'media.deleted' and payload->>'assetId' = ${asset!.id}`;
    expect(events).toHaveLength(1);
  });
});
