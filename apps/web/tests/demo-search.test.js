import { SNIPPET_MARK_END, SNIPPET_MARK_START, snippetParts } from '@grand/contracts';
import { describe, expect, it } from 'vitest';

import { indexDocument, parseQuery, rank, snippet, stem } from '../src/demo/fulltext.js';
import { lessonId, setup, thread } from './demo-setup.js';

/**
 * Search in the demo's mock API (apps/api/src/search): the full-text engine that stands in for
 * Postgres's (stemming, prefixes, weights, snippets), and who finds what.
 */

const mark = (word) => `${SNIPPET_MARK_START}${word}${SNIPPET_MARK_END}`;

describe('the full-text engine', () => {
  it('meets the common forms of a word', () => {
    const same = [
      ['vectors', 'vector'],
      ['matrices', 'matrix'],
      ['transforming', 'transform'],
      ['studies', 'study'],
      ['studied', 'study'],
      ['graded', 'grade'],
      ['grades', 'grade'],
      ['beats', 'beat'],
      ['beating', 'beat'],
      ['running', 'run'],
      ['classes', 'class'],
      ['boxes', 'box'],
      ['harmonics', 'harmonic'],
      ['civilizations', 'civilization'],
      ['tuning', 'tune'],
    ];
    for (const [a, b] of same) expect(stem(a), `${a} / ${b}`).toBe(stem(b));
    // Words that only look alike stay apart.
    expect(stem('basis')).toBe('basis');
    expect(stem('loudness')).toBe('loudness');
    expect(stem('string')).toBe('string');
    expect(stem('440')).toBe('440');
  });

  it('reads a query as the API does: words of letters and digits, common words dropped, the last one a prefix', () => {
    expect(parseQuery('Linear  algebra vec')).toEqual([
      { term: 'linear', prefix: false },
      { term: 'algebra', prefix: false },
      { term: 'vec', prefix: true },
    ]);
    expect(parseQuery("Déterminant's & (x | !y)")).toEqual([
      { term: 'determinant', prefix: false },
      { term: 'x', prefix: false },
      { term: 'y', prefix: true },
    ]);
    expect(parseQuery('why the rivers')).toEqual([{ term: 'river', prefix: true }]);
    expect(parseQuery('the of and')).toBeNull();
    expect(parseQuery('   !!! ')).toBeNull();
    expect(parseQuery('one two three four five six seven eight nine ten')).toHaveLength(8);
  });

  it('needs every word, and weighs titles over summaries over the long text', () => {
    const query = parseQuery('vector');
    const title = rank(indexDocument({ A: 'What a vector is', B: 'Arrows', C: '' }), query);
    const summary = rank(indexDocument({ A: 'Arrows', B: 'What a vector is', C: '' }), query);
    const notes = rank(indexDocument({ A: 'Arrows', B: 'Lists', C: `A vector, ${'and another vector, '.repeat(30)}and a last vector.` }), query);
    expect(title).toBeGreaterThan(summary);
    expect(summary).toBeGreaterThan(notes);
    expect(notes).toBeGreaterThan(0);
    expect(rank(indexDocument({ A: 'What a vector is' }), parseQuery('vector matrix'))).toBe(0);
    expect(rank(indexDocument({ A: 'Matrices' }), parseQuery('vector matr'))).toBe(0);
    expect(rank(indexDocument({ A: 'Vectors and matrices' }), parseQuery('vector matr'))).toBeGreaterThan(0);
  });

  it('quotes about 28 words around the first match, with the matches marked, never markup', () => {
    const text = `## Key ideas\n- The **determinant** is the factor by which a transformation scales area. ${'More words follow here. '.repeat(20)}`;
    const quoted = snippet(text, parseQuery('determinants'));
    expect(quoted).toContain(`The ${mark('determinant')} is the factor`);
    expect(quoted).not.toMatch(/[*#]/);
    expect(quoted.endsWith(' …')).toBe(true);
    expect(quoted.split(/\s+/).length).toBeLessThanOrEqual(30);
    const late = snippet(`${'Filler words before it. '.repeat(20)}At last a vector appears, (vectors, too).`, parseQuery('vector'));
    expect(late.startsWith('… ')).toBe(true);
    expect(late).toContain(`a ${mark('vector')} appears, (${mark('vectors')}, too).`);
    expect(
      snippetParts(late)
        .filter((part) => part.match)
        .map((part) => part.text),
    ).toEqual(['vector', 'vectors']);
    // Nothing matches in the text (the title did): its first words, unmarked.
    expect(snippet('Arrows, lists of numbers, and why both views matter.', parseQuery('vector'))).toBe('Arrows, lists of numbers, and why both views matter.');
  });
});

describe('searching the school', () => {
  const search = (call, token, q, extra = '') => call('GET', `/schools/grand-academy/search?q=${encodeURIComponent(q)}${extra}`, { token });

  it('finds courses, lessons and discussions by any form of a word, and as you type', async () => {
    const { call, signIn } = setup();
    const amira = await signIn('amira');
    const vectors = (await search(call, amira, 'vectors')).body;
    expect(vectors.query).toBe('vectors');
    expect(vectors.courses.items[0]).toMatchObject({ slug: 'linear-algebra-visually', status: 'published', enrolled: true });
    expect(vectors.courses.items[0].snippet).toContain(mark('vectors'));
    // A title match ranks above matches in summaries and notes.
    expect(vectors.lessons.items[0]).toMatchObject({
      id: lessonId('linear-algebra-visually', 'vectors'),
      title: 'What a vector really is',
      courseSlug: 'linear-algebra-visually',
      kind: 'lesson',
      locked: false,
    });
    expect(vectors.lessons.items.length).toBeGreaterThan(1);
    expect(vectors.discussions.total).toBeGreaterThan(0);

    // The last word as a prefix.
    const determ = (await search(call, amira, 'determ')).body.lessons.items;
    expect(determ[0]).toMatchObject({ id: lessonId('linear-algebra-visually', 'determinant'), locked: false });
    expect(determ[0].snippet).toContain(mark('determinant'));
    // Irregular plurals meet too.
    expect((await search(call, amira, 'matrix')).body.lessons.items.map((item) => item.id)).toEqual(
      expect.arrayContaining([lessonId('linear-algebra-visually', 'transformations'), lessonId('linear-algebra-visually', 'composition')]),
    );

    // Discussions: threads by their title, replies under their thread.
    const salt = (await search(call, amira, 'salt')).body.discussions.items;
    expect(salt[0]).toMatchObject({
      id: thread('first-civilizations', 'salinisation'),
      threadId: thread('first-civilizations', 'salinisation'),
      title: 'How fast did salt actually ruin Mesopotamian fields?',
      authorName: 'Amira Haddad',
      lessonId: null,
    });
    const fromOmar = salt.find((item) => item.id === thread('first-civilizations', 'salinisation', 'omar'));
    expect(fromOmar).toMatchObject({
      threadId: thread('first-civilizations', 'salinisation'),
      title: 'How fast did salt actually ruin Mesopotamian fields?',
      authorName: 'Omar Siddiqui',
    });
    const comment = (await search(call, amira, 'grain receipts')).body.discussions.items[0];
    expect(comment).toMatchObject({
      threadId: thread('first-civilizations', 'comment', 'receipts'),
      title: null,
      lessonId: lessonId('first-civilizations', 'mesopotamia'),
      lessonTitle: 'Mesopotamia',
    });
  });

  it('shows only what each person may see, and never the notes of a lesson they can’t open', async () => {
    const { call, signIn } = setup();
    const amira = await signIn('amira');
    const daniel = await signIn('daniel');
    const lena = await signIn('lena');

    // Not enrolled in Neural Networks: its lessons show, locked, found and quoted by title and summary only.
    const gradient = (await search(call, amira, 'gradient descent')).body.lessons.items.find((item) => item.id === lessonId('neural-networks', 'gradient-descent'));
    expect(gradient).toMatchObject({ locked: true, title: 'Gradient descent' });
    expect(gradient.snippet).toBe('Rolling downhill on the cost function.');
    // "Mini-batches" is only in the backpropagation notes (and a thread Amira can't read).
    const batches = (await search(call, amira, 'mini-batches')).body;
    expect(batches.lessons.total).toBe(0);
    expect(batches.discussions.total).toBe(0);
    const forLena = (await search(call, lena, 'mini-batches')).body;
    expect(forLena.lessons.items[0]).toMatchObject({ id: lessonId('neural-networks', 'backpropagation'), locked: false });
    expect(forLena.lessons.items[0].snippet).toContain(mark('mini'));
    expect(forLena.discussions.items.map((item) => item.threadId)).toContain(thread('neural-networks', 'mini-batches'));
    // A free preview is open to everyone, notes too: "784" is only in its notes.
    expect((await search(call, amira, '784')).body.lessons.items[0]).toMatchObject({ id: lessonId('neural-networks', 'what-is-a-network'), locked: false });

    // A draft course and a draft lesson: their editors only.
    expect((await search(call, amira, 'python')).body.courses.total).toBe(0);
    expect((await search(call, daniel, 'python')).body.courses.items[0]).toMatchObject({ slug: 'python-for-beginners', status: 'draft', enrolled: false });
    expect((await search(call, lena, 'python')).body.courses.total).toBe(1);
    expect((await search(call, amira, 'standing waves')).body.lessons.total).toBe(0);
    expect((await search(call, daniel, 'standing waves')).body.lessons.items[0]).toMatchObject({ id: lessonId('physics-of-sound', 'resonance'), locked: false });

    // Discussions: for those taking part in the course, and never hidden posts.
    expect((await search(call, amira, 'sigmoid')).body.discussions.total).toBe(0);
    expect((await search(call, lena, 'sigmoid')).body.discussions.total).toBeGreaterThan(0);
    expect((await search(call, amira, 'top marks')).body.discussions.total).toBe(0);
    expect((await search(call, daniel, 'top marks')).body.discussions.total).toBe(0);
  });

  it('pages one type at a time, counting every type', async () => {
    const { call, signIn } = setup();
    const amira = await signIn('amira');
    const lessons = (await search(call, amira, 'vector', '&type=lessons&limit=2')).body;
    expect(lessons.courses).toMatchObject({ items: [] });
    expect(lessons.courses.total).toBeGreaterThan(0);
    expect(lessons.lessons.items).toHaveLength(2);
    const all = (await search(call, amira, 'vector', '&type=lessons&limit=50')).body.lessons.items.map((item) => item.id);
    const second = (await search(call, amira, 'vector', '&type=lessons&limit=2&offset=2')).body.lessons.items.map((item) => item.id);
    expect(second).toEqual(all.slice(2, 4));
    // With "all", the offset is ignored: the first few of each.
    expect((await search(call, amira, 'vector', '&limit=2&offset=2')).body.lessons.items.map((item) => item.id)).toEqual(all.slice(0, 2));
  });

  it('checks what it’s asked, and is for members', async () => {
    const { call, signIn } = setup();
    const amira = await signIn('amira');
    expect((await search(call, amira, 'a')).body.error).toMatchObject({ code: 'validation_failed', details: [{ path: 'q', message: 'Type at least 2 characters' }] });
    expect((await search(call, amira, 'vector', '&type=people')).status).toBe(400);
    expect((await search(call, amira, 'the and')).body).toEqual({
      query: 'the and',
      courses: { items: [], total: 0 },
      lessons: { items: [], total: 0 },
      discussions: { items: [], total: 0 },
    });
    const lena = await signIn('lena');
    await call('POST', '/schools', { token: lena, body: { name: 'Night School', slug: 'night-school' } });
    expect((await call('GET', '/schools/night-school/search?q=vector', { token: amira })).body.error).toMatchObject({
      code: 'forbidden',
      message: "You're not a member of this school.",
    });
    expect((await call('GET', '/schools/grand-academy/search?q=vector')).status).toBe(401);
  });
});
