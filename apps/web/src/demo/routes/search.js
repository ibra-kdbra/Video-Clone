import { searchQuery } from '@grand/contracts';

import { indexDocument, parseQuery, rank, snippet } from '../fulltext.js';
import { canEditCourse, canSeeCourse, iso } from '../logic.js';
import { isEnrolled } from './shared.js';

/**
 * Search across the school (apps/api/src/search): courses, their lessons and their discussions,
 * each as far as the viewer may see them, ranked by relevance (see ../fulltext.js). Lessons the
 * viewer can't open are found by their title and summary only, never their notes. Every type's
 * total is counted; items come for the types asked for.
 */

const empty = () => ({ items: [], total: 0 });

/**
 * Each row's words, indexed once per way of reading it ('full', or a lesson's 'outline'): rows are
 * replaced when they change, so a stale index is never used.
 */
const indexes = { full: new WeakMap(), outline: new WeakMap() };
const indexOf = (row, fields, view = 'full') => {
  let index = indexes[view].get(row);
  if (!index) {
    index = indexDocument(fields(row));
    indexes[view].set(row, index);
  }
  return index;
};

/** Ranked matches: [{ row, score }], best first, ties by `tie`. `fields(row)` gives the fields and which index of them to use. */
function ranked(rows, fields, query, tie) {
  const found = [];
  for (const row of rows) {
    const { view, of } = fields(row);
    const score = rank(indexOf(row, of, view), query);
    if (score > 0) found.push({ row, score });
  }
  return found.sort((a, b) => b.score - a.score || tie(a.row, b.row));
}

const full = (of) => () => ({ view: 'full', of });

function section(found, limit, offset, map) {
  return { items: limit ? found.slice(offset, offset + limit).map(({ row }) => map(row)) : [], total: Math.min(found.length, 500) };
}

const byTitle = (a, b) => a.title.localeCompare(b.title, 'en');

export function register(router) {
  router.add('GET', '/schools/:slug/search', { school: 'student', query: searchQuery }, (ctx) => {
    const { db, school, auth, query } = ctx;
    const parsed = parseQuery(query.q);
    if (!parsed) return { query: query.q, courses: empty(), lessons: empty(), discussions: empty() };
    const limitFor = (type) => (query.type === 'all' || query.type === type ? query.limit : 0);
    const offset = query.type === 'all' ? 0 : query.offset;

    const courses = new Map(db.filter('courses', (row) => row.schoolId === school.id && canSeeCourse(school, auth.userId, row)).map((row) => [row.id, row]));
    const editor = (course) => canEditCourse(school, auth.userId, course);
    const enrolled = new Map([...courses.keys()].map((id) => [id, isEnrolled(db, id, auth.userId)]));

    const courseHits = ranked([...courses.values()], full((row) => ({ A: row.title, B: row.summary, C: row.description })), parsed, byTitle);

    // A lesson's notes are for those who may open it. For the others (not enrolled, and not a free
    // preview), it's found, ranked and quoted by its title and summary only, as on the course page.
    const lessons = db.filter('lessons', (row) => {
      const course = courses.get(row.courseId);
      return Boolean(course) && (row.status === 'published' || editor(course));
    });
    const opens = (row) => {
      const course = courses.get(row.courseId);
      return editor(course) || (course.status === 'published' && row.status === 'published' && (row.isPreview || enrolled.get(course.id)));
    };
    const lessonHits = ranked(
      lessons,
      (row) => (opens(row) ? { view: 'full', of: (item) => ({ A: item.title, B: item.summary, C: item.notes }) } : { view: 'outline', of: (item) => ({ A: item.title, B: item.summary }) }),
      parsed,
      byTitle,
    );

    // Discussions: visible posts, not under a hidden thread, in courses the viewer takes part in.
    const readable = (course) => editor(course) || (course.status === 'published' && enrolled.get(course.id));
    const posts = db.filter('posts', (row) => {
      if (row.status !== 'visible') return false;
      const course = courses.get(row.courseId);
      if (!course || !readable(course)) return false;
      if (row.parentId && db.get('posts', row.parentId)?.status === 'hidden') return false;
      if (row.lessonId) {
        const lesson = db.get('lessons', row.lessonId);
        if (!lesson || (lesson.status !== 'published' && !editor(course))) return false;
      }
      return true;
    });
    const postHits = ranked(posts, full((row) => ({ A: row.title ?? '', B: row.body })), parsed, (a, b) => b.createdAt - a.createdAt);

    return {
      query: query.q,
      courses: section(courseHits, limitFor('courses'), offset, (row) => ({
        id: row.id,
        slug: row.slug,
        title: row.title,
        summary: row.summary,
        snippet: snippet(`${row.summary} ${row.description}`, parsed),
        status: row.status,
        enrolled: enrolled.get(row.id),
      })),
      lessons: section(lessonHits, limitFor('lessons'), offset, (row) => {
        const course = courses.get(row.courseId);
        const open = opens(row);
        return {
          id: row.id,
          courseSlug: course.slug,
          courseTitle: course.title,
          title: row.title,
          kind: row.kind,
          snippet: snippet(open ? `${row.summary} ${row.notes}` : row.summary, parsed),
          locked: !open,
        };
      }),
      discussions: section(postHits, limitFor('discussions'), offset, (row) => {
        const course = courses.get(row.courseId);
        const parent = row.parentId ? db.get('posts', row.parentId) : null;
        const lesson = row.lessonId ? db.get('lessons', row.lessonId) : null;
        const author = row.authorId ? db.get('users', row.authorId) : null;
        return {
          id: row.id,
          threadId: row.parentId ?? row.id,
          courseSlug: course.slug,
          courseTitle: course.title,
          lessonId: row.lessonId,
          lessonTitle: lesson?.title ?? null,
          title: row.title ?? parent?.title ?? null,
          snippet: snippet(row.body, parsed),
          authorName: author?.name ?? null,
          createdAt: iso(row.createdAt),
        };
      }),
    };
  });
}
