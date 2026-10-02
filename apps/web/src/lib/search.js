import { coursePath, lessonPath } from './courses.js';
import { searchPath } from './searchRoute.js';
import { apiFetch } from './session.js';

// Kept apart for the top bar, which needs only these two and ships with the app.
export { searchPath, searchSchoolFor } from './searchRoute.js';

/**
 * Searching a school (Phase 3): its courses, their lessons and their discussions, as far as the
 * viewer may see them. The top bar's search field is on every page, so this module stays small
 * and doesn't use @grand/contracts (which would bring zod along); the snippets' highlighting,
 * which does, is in components/Snippet.jsx, loaded with the suggestions and the results page.
 */
const seg = encodeURIComponent;

/** Shorter queries aren't sent (the API wants at least this many characters). */
export const MIN_QUERY = 2;
export const MAX_QUERY = 100;
/** Suggestions: this many of each kind. The results page: this many per page of one kind. */
export const SUGGEST_LIMIT = 4;
export const PREVIEW_LIMIT = 5;
export const PAGE_LIMIT = 20;

export const SEARCH_TABS = [
  { key: 'all', label: 'All' },
  { key: 'courses', label: 'Courses', icon: 'layers' },
  { key: 'lessons', label: 'Lessons', icon: 'film' },
  { key: 'discussions', label: 'Discussions', icon: 'message' },
];

/** The query as sent: trimmed, spaces collapsed, at most MAX_QUERY characters. */
export const cleanQuery = (value) =>
  String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, MAX_QUERY);

export function searchSchool(slug, { q, type = 'all', limit = PREVIEW_LIMIT, offset = 0 }, signal) {
  const params = new URLSearchParams({ q, type, limit: String(limit) });
  if (offset) params.set('offset', String(offset));
  return apiFetch(`/schools/${seg(slug)}/search?${params}`, { signal });
}

export const searchKeys = {
  all: ['search'],
  suggest: (slug, q) => ['search', slug, 'suggest', q],
  preview: (slug, q) => ['search', slug, 'all', q],
  list: (slug, q, type) => ['search', slug, type, q],
};

/** Where a discussion hit leads: its thread, or the lesson with the comment brought into view. */
export function discussionHitPath(slug, hit) {
  if (hit.lessonId) return `${lessonPath(slug, hit.courseSlug, hit.lessonId)}?comment=${seg(hit.threadId)}`;
  const thread = `${coursePath(slug, hit.courseSlug)}/discussions/${seg(hit.threadId)}`;
  return hit.id !== hit.threadId ? `${thread}?post=${seg(hit.id)}` : thread;
}

export const courseHitPath = (slug, hit) => coursePath(slug, hit.slug);
export const lessonHitPath = (slug, hit) => lessonPath(slug, hit.courseSlug, hit.id);

/** A discussion hit's heading: the thread's title, or what the comment is under. */
export const discussionHitTitle = (hit) => hit.title ?? (hit.lessonTitle ? `Comment on ${hit.lessonTitle}` : 'Comment');

/**
 * The suggestions under the search field, in the order the arrow keys move through them: courses,
 * lessons, discussions (each `{ id, kind, hit, to }`), and last "See all results".
 */
export function suggestionOptions(slug, results, q) {
  if (!results) return [];
  const options = [
    ...(results.courses?.items ?? []).map((hit) => ({ id: `course-${hit.id}`, kind: 'courses', hit, to: courseHitPath(slug, hit) })),
    ...(results.lessons?.items ?? []).map((hit) => ({ id: `lesson-${hit.id}`, kind: 'lessons', hit, to: lessonHitPath(slug, hit) })),
    ...(results.discussions?.items ?? []).map((hit) => ({ id: `post-${hit.id}`, kind: 'discussions', hit, to: discussionHitPath(slug, hit) })),
  ];
  options.push({ id: 'all', kind: 'all', hit: null, to: searchPath(slug, q) });
  return options;
}

/** How many match in all, across the three kinds. */
export const totalOf = (results) => (results ? results.courses.total + results.lessons.total + results.discussions.total : 0);

/** "500+" at the API's cap, so the count doesn't claim to be exact. */
export const countLabel = (total) => (total >= 500 ? '500+' : total.toLocaleString());

/** For one kind's pages (useInfiniteQuery): the next offset, or undefined when all are loaded. */
export function nextOffset(lastPage, pages, type) {
  const loaded = pages.reduce((sum, page) => sum + page[type].items.length, 0);
  const total = lastPage[type].total;
  return loaded < total && lastPage[type].items.length > 0 && loaded < 500 ? loaded : undefined;
}
