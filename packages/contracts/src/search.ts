import { z } from 'zod';
import type { LessonKind } from './courses.js';

/**
 * Searching a school: its courses, their lessons, and their discussions, as far as the viewer may
 * see them. Words match their other forms ("vectors" finds "vector"), and the last word matches as
 * a prefix, so results come while typing.
 */
export const SEARCH_TYPES = ['all', 'courses', 'lessons', 'discussions'] as const;
export type SearchType = (typeof SEARCH_TYPES)[number];

export const searchQuery = z.strictObject({
  q: z.string().trim().min(2, 'Type at least 2 characters').max(100, 'Use at most 100 characters'),
  type: z.enum(SEARCH_TYPES).default('all'),
  /** Per type: with `all`, at most this many of each. */
  limit: z.coerce.number().int().min(1).max(50).default(5),
  /** For paging through one type; ignored with `all`, which returns the first of each. */
  offset: z.coerce.number().int().min(0).max(500).default(0),
});
export type SearchQuery = z.infer<typeof searchQuery>;

/**
 * Snippets mark the matched words with these two characters (they can't appear in stored text),
 * so the page can highlight them without ever treating the text as HTML.
 */
export const SNIPPET_MARK_START = '\u0002';
export const SNIPPET_MARK_END = '\u0003';

/** Splits a snippet into plain and highlighted parts. */
export function snippetParts(snippet: string): { text: string; match: boolean }[] {
  const parts: { text: string; match: boolean }[] = [];
  for (const [index, piece] of snippet.split(SNIPPET_MARK_START).entries()) {
    if (index === 0) {
      if (piece) parts.push({ text: piece, match: false });
      continue;
    }
    const [match = '', rest = ''] = piece.split(SNIPPET_MARK_END);
    if (match) parts.push({ text: match, match: true });
    if (rest) parts.push({ text: rest, match: false });
  }
  return parts;
}

export interface SearchCourseHit {
  id: string;
  slug: string;
  title: string;
  summary: string;
  snippet: string;
  status: 'draft' | 'published' | 'archived';
  enrolled: boolean;
}

export interface SearchLessonHit {
  id: string;
  courseSlug: string;
  courseTitle: string;
  title: string;
  kind: LessonKind;
  snippet: string;
  /** The viewer can see it's there but can't open it yet (not enrolled). */
  locked: boolean;
}

export interface SearchDiscussionHit {
  id: string;
  /** The thread or lesson comment it belongs to (itself, when it's one). */
  threadId: string;
  courseSlug: string;
  courseTitle: string;
  lessonId: string | null;
  lessonTitle: string | null;
  /** The thread's title; null for lesson comments. */
  title: string | null;
  snippet: string;
  authorName: string | null;
  createdAt: string;
}

export interface SearchSection<T> {
  items: T[];
  /** How many match in all, up to 500. */
  total: number;
}

export interface SearchResults {
  query: string;
  courses: SearchSection<SearchCourseHit>;
  lessons: SearchSection<SearchLessonHit>;
  discussions: SearchSection<SearchDiscussionHit>;
}
