import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SNIPPET_MARK_END as E, SNIPPET_MARK_START as S, searchQuery } from '@grand/contracts';

import Snippet from '../src/components/Snippet.jsx';
import {
  MAX_QUERY,
  MIN_QUERY,
  cleanQuery,
  countLabel,
  discussionHitPath,
  discussionHitTitle,
  nextOffset,
  searchPath,
  searchSchoolFor,
  suggestionOptions,
  totalOf,
} from '../src/lib/search.js';

const html = (text) => renderToStaticMarkup(createElement(Snippet, { text }));

describe('search snippets', () => {
  it('highlight the marked words as <mark>, and nothing else', () => {
    expect(html(`Play the ${S}scale${E} slowly, then the ${S}scales${E} again`)).toBe(
      '<span>Play the <mark>scale</mark> slowly, then the <mark>scales</mark> again</span>',
    );
    expect(html(`${S}Vectors${E}`)).toBe('<span><mark>Vectors</mark></span>');
    expect(html('No match here')).toBe('<span>No match here</span>');
    expect(html('')).toBe('<span></span>');
  });

  it('never let the text become markup', () => {
    const out = html(`<img src=x onerror=alert(1)> and ${S}<b>bold</b>${E}`);
    expect(out).toBe('<span>&lt;img src=x onerror=alert(1)&gt; and <mark>&lt;b&gt;bold&lt;/b&gt;</mark></span>');
    expect(out).not.toMatch(/<img|<b>/);
  });

  it('survive marks that don’t pair up', () => {
    expect(html(`a ${S}b`)).toBe('<span>a <mark>b</mark></span>');
    expect(html(`a${E} b`)).toBe(`<span>a${E} b</span>`);
  });
});

describe('the search field', () => {
  it('sends queries as the API wants them', () => {
    expect(cleanQuery('  piano   scales ')).toBe('piano scales');
    expect(cleanQuery('x'.repeat(150))).toHaveLength(MAX_QUERY);
    expect(searchQuery.safeParse({ q: 'x'.repeat(MIN_QUERY) }).success).toBe(true);
    expect(searchQuery.safeParse({ q: 'x'.repeat(MIN_QUERY - 1) }).success).toBe(false);
  });

  it('looks in the school the page belongs to, else the first', () => {
    const schools = [{ slug: 'riverside' }, { slug: 'hillside' }];
    expect(searchSchoolFor('/s/hillside/c/piano', schools).slug).toBe('hillside');
    expect(searchSchoolFor('/s/elsewhere', schools).slug).toBe('riverside');
    expect(searchSchoolFor('/', schools).slug).toBe('riverside');
    expect(searchSchoolFor('/account', schools).slug).toBe('riverside');
    expect(searchSchoolFor('/', [])).toBeNull();
  });

  it('links to the results page', () => {
    expect(searchPath('riverside', 'piano scales')).toBe('/s/riverside/search?q=piano+scales');
    expect(searchPath('riverside', 'piano', 'lessons')).toBe('/s/riverside/search?q=piano&type=lessons');
    expect(searchPath('riverside')).toBe('/s/riverside/search');
  });
});

const results = {
  query: 'scale',
  courses: { items: [{ id: 'c1', slug: 'piano', title: 'Piano', summary: '', snippet: '', status: 'published', enrolled: true }], total: 1 },
  lessons: { items: [{ id: 'l1', courseSlug: 'piano', courseTitle: 'Piano', title: 'Scales', kind: 'lesson', snippet: '', locked: true }], total: 12 },
  discussions: {
    items: [
      {
        id: 't1',
        threadId: 't1',
        courseSlug: 'piano',
        courseTitle: 'Piano',
        lessonId: null,
        lessonTitle: null,
        title: 'Which scale first?',
        snippet: '',
        authorName: 'Jonah',
        createdAt: '',
      },
      {
        id: 'r1',
        threadId: 't1',
        courseSlug: 'piano',
        courseTitle: 'Piano',
        lessonId: null,
        lessonTitle: null,
        title: 'Which scale first?',
        snippet: '',
        authorName: 'Ada',
        createdAt: '',
      },
      {
        id: 'c9',
        threadId: 'c8',
        courseSlug: 'piano',
        courseTitle: 'Piano',
        lessonId: 'l1',
        lessonTitle: 'Scales',
        title: null,
        snippet: '',
        authorName: null,
        createdAt: '',
      },
    ],
    total: 3,
  },
};

describe('search results', () => {
  it('lead each hit to its place', () => {
    const [t, r, c] = results.discussions.items;
    expect(discussionHitPath('riverside', t)).toBe('/s/riverside/c/piano/discussions/t1');
    expect(discussionHitPath('riverside', r)).toBe('/s/riverside/c/piano/discussions/t1?post=r1');
    expect(discussionHitPath('riverside', c)).toBe('/s/riverside/c/piano/l/l1?comment=c8');
    expect(discussionHitTitle(c)).toBe('Comment on Scales');
    expect(discussionHitTitle({ title: null, lessonTitle: null })).toBe('Comment');
  });

  it('become suggestions in arrow-key order, with "See all" last', () => {
    const options = suggestionOptions('riverside', results, 'scale');
    expect(options.map((option) => option.id)).toEqual(['course-c1', 'lesson-l1', 'post-t1', 'post-r1', 'post-c9', 'all']);
    expect(options[1].to).toBe('/s/riverside/c/piano/l/l1');
    expect(options.at(-1).to).toBe('/s/riverside/search?q=scale');
    expect(suggestionOptions('riverside', undefined, 'x')).toEqual([]);
    expect(totalOf(results)).toBe(16);
    expect(countLabel(12)).toBe('12');
    expect(countLabel(500)).toBe('500+');
  });

  it('page through one kind until all are loaded', () => {
    const page = (n, total) => ({ ...results, lessons: { items: Array.from({ length: n }, (_, i) => ({ id: `l${i}` })), total } });
    expect(nextOffset(page(20, 45), [page(20, 45)], 'lessons')).toBe(20);
    expect(nextOffset(page(5, 45), [page(20, 45), page(20, 45), page(5, 45)], 'lessons')).toBeUndefined();
    expect(nextOffset(page(0, 45), [page(20, 45), page(0, 45)], 'lessons')).toBeUndefined();
  });
});
