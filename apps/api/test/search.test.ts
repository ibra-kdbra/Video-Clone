import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { SNIPPET_MARK_END, SNIPPET_MARK_START } from '@grand/contracts';
import { toTsQuery } from '../src/search/search.service.js';
import { as, courseWithPeople } from './fixtures.js';
import { TestApi } from './helpers.js';

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

type Results = {
  courses: { items: { slug: string; snippet: string; enrolled: boolean; status: string }[]; total: number };
  lessons: { items: { id: string; title: string; locked: boolean; snippet: string }[]; total: number };
  discussions: { items: { id: string; threadId: string; title: string | null; snippet: string }[]; total: number };
};

describe('search', () => {
  it('turns what was typed into a safe prefix query', () => {
    expect(toTsQuery('Linear  algebra vec')).toBe('linear & algebra & vec:*');
    expect(toTsQuery("déterminant's & (x | !y)")).toBe('determinant & s & x & y:*');
    expect(toTsQuery('   !!! ')).toBeNull();
  });

  it('finds courses and lessons by any form of a word, and as you type', async () => {
    const s = await courseWithPeople(api, owner);
    const search = async (q: string, type = 'all') =>
      (await as(api, s.student).get(`/schools/${s.school.slug}/search?q=${encodeURIComponent(q)}&type=${type}`)).body as Results;

    // "transformation" (singular) finds the course's summary ("transformations"); "determ" the lesson.
    expect((await search('transformation')).courses.items.map((course) => course.slug)).toEqual([s.courseSlug]);
    const lessons = (await search('determ')).lessons.items;
    expect(lessons.map((lesson) => lesson.id)).toEqual([s.lessons.determinant]);
    expect(lessons[0]!.snippet).toContain(`${SNIPPET_MARK_START}determinant${SNIPPET_MARK_END}`);
    expect(lessons[0]!.locked).toBe(false);

    // A title match ranks above a match in the notes.
    const arrows = (await search('arrow')).lessons.items.map((lesson) => lesson.id);
    expect(arrows[0]).toBe(s.lessons.vectors);

    // One type at a time: its items, and every type's total.
    const only = await search('vector', 'lessons');
    expect(only.courses.items).toEqual([]);
    expect(only.lessons.items.length).toBeGreaterThan(0);
    expect(only.courses.total).toBeGreaterThan(0);
  });

  it('shows only what each person may see', async () => {
    const s = await courseWithPeople(api, owner);
    const search = async (person: typeof s.student, q: string) =>
      (await as(api, person).get(`/schools/${s.school.slug}/search?q=${encodeURIComponent(q)}`)).body as Results;

    // A draft lesson: its editors only.
    expect((await search(s.student, 'eigenvectors')).lessons.total).toBe(0);
    expect((await search(s.author, 'eigenvectors')).lessons.items.map((lesson) => lesson.id)).toEqual([s.lessons.draft]);

    // Not enrolled: the lessons show, locked, found and quoted by their title and summary only.
    const locked = (await search(s.outsider, 'determinant')).lessons.items[0];
    expect(locked).toMatchObject({ id: s.lessons.determinant, locked: true });
    expect(locked!.snippet).not.toContain('measures');
    expect((await search(s.outsider, 'tail')).lessons.total).toBe(0);
    expect((await search(s.student, 'tail')).lessons.items.map((lesson) => lesson.id)).toEqual([s.lessons.vectors]);
    // A free preview is open to everyone, notes too.
    await as(api, s.author).patch(`${s.url}/lessons/${s.lessons.vectors}`, { isPreview: true });
    expect((await search(s.outsider, 'tail')).lessons.items[0]).toMatchObject({ id: s.lessons.vectors, locked: false });

    // A draft course: nobody but its editors.
    const draft = await as(api, s.author).post(`/schools/${s.school.slug}/courses`, { title: 'Secret Topology', summary: 'Doughnuts and coffee cups.' });
    expect(draft.status).toBe(201);
    expect((await search(s.student, 'topology')).courses.total).toBe(0);
    expect((await search(s.author, 'topology')).courses.items[0]).toMatchObject({ status: 'draft' });
    expect((await search(s.colleague, 'topology')).courses.total).toBe(0);
    expect((await search(s.head, 'topology')).courses.total).toBe(1);

    // Discussions: for those taking part in the course, and never hidden posts.
    const thread = await as(api, s.student).post(`${s.url}/discussions`, { title: 'Why is the determinant of a rotation one?', body: 'Rotations keep areas the same, right?' });
    expect(thread.status).toBe(201);
    const hidden = await as(api, s.other).post(`${s.url}/discussions/${thread.body.id}/replies`, { body: 'Rotations are boring, buy my crypto' });
    await as(api, s.author).post(`${s.url}/discussions/${hidden.body.id}/moderate`, { hidden: true });
    const found = await search(s.other, 'rotation');
    expect(found.discussions.items.map((item) => item.id)).toEqual([thread.body.id]);
    expect(found.discussions.items[0]!.title).toBe('Why is the determinant of a rotation one?');
    expect((await search(s.other, 'crypto')).discussions.total).toBe(0);
    expect((await search(s.outsider, 'rotation')).discussions.total).toBe(0);
  });

  it('checks what it is asked', async () => {
    const s = await courseWithPeople(api, owner);
    expect((await as(api, s.student).get(`/schools/${s.school.slug}/search?q=a`)).status).toBe(400);
    expect((await as(api, s.student).get(`/schools/${s.school.slug}/search?q=vector&type=people`)).status).toBe(400);
    const stranger = await api.signup('Stranger');
    expect((await as(api, stranger).get(`/schools/${s.school.slug}/search?q=vector`)).status).toBe(403);
  });
});
