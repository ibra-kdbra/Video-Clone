import { Injectable } from '@nestjs/common';
import {
  ROLE_RANK,
  type SearchCourseHit,
  type SearchDiscussionHit,
  type SearchLessonHit,
  type SearchQuery,
  type SearchResults,
  type SearchSection,
} from '@grand/contracts';
import { sql, type SQL } from 'drizzle-orm';
import type { SchoolContext } from '../common/request-context.js';
import { DatabaseService, type Tx } from '../database/database.service.js';

/**
 * The words of a search as a tsquery: up to eight words, each matched in all its forms (English
 * stemming), the last also as a prefix, so results come while someone is still typing. Only
 * letters and digits get through, so nothing typed can change the query's meaning.
 */
export function toTsQuery(text: string): string | null {
  const words = (
    text
      .normalize('NFKD')
      .replace(/\p{M}+/gu, '')
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu) ?? []
  ).slice(0, 8);
  if (!words.length) return null;
  return words.map((word, index) => (index === words.length - 1 ? `${word}:*` : word)).join(' & ');
}

// ts_headline's options: matches between \u0002 and \u0003 (see SNIPPET_MARK_START), one fragment
// of about 25 words.
const HEADLINE = sql.raw(`'StartSel=' || chr(2) || ', StopSel=' || chr(3) || ', MaxWords=28, MinWords=12, ShortWord=2, MaxFragments=1, FragmentDelimiter=" … "'`);

// Markdown's markers don't belong in a snippet.
const plain = (column: SQL) => sql`regexp_replace(${column}, '[*_\`#>|~]+|\\[|\\]\\([^)]*\\)', ' ', 'g')`;

const empty = <T>(): SearchSection<T> => ({ items: [], total: 0 });

/**
 * Search across a school: courses, their lessons, and their discussions, each as far as the viewer
 * may see them (the same rules as browsing), ranked by Postgres full-text relevance.
 */
@Injectable()
export class SearchService {
  constructor(private readonly db: DatabaseService) {}

  async search(school: SchoolContext, userId: string, query: SearchQuery): Promise<SearchResults> {
    const tsquery = toTsQuery(query.q);
    if (!tsquery) return { query: query.q, courses: empty(), lessons: empty(), discussions: empty() };
    const wants = (type: SearchQuery['type']) => query.type === 'all' || query.type === type;
    const limitFor = (type: SearchQuery['type']) => (wants(type) ? query.limit : 0);
    const offset = query.type === 'all' ? 0 : query.offset;

    return this.db.transaction({ userId, schoolId: school.id }, async (tx) => {
      const viewer = viewerSql(school, userId);
      const [courses, lessons, discussions] = await Promise.all([
        this.courses(tx, tsquery, viewer, limitFor('courses'), offset),
        this.lessons(tx, tsquery, viewer, limitFor('lessons'), offset),
        this.discussions(tx, tsquery, viewer, limitFor('discussions'), offset),
      ]);
      return { query: query.q, courses, lessons, discussions };
    });
  }

  private async courses(tx: Tx, tsquery: string, v: Viewer, limit: number, offset: number): Promise<SearchSection<SearchCourseHit>> {
    const rows = await tx.execute<{ id: string; slug: string; title: string; summary: string; status: SearchCourseHit['status']; snippet: string; enrolled: boolean; total: number }>(sql`
      select c.id, c.slug, c.title, c.summary, c.status,
             ${limit ? sql`ts_headline('english', ${plain(sql`c.summary || ' ' || c.description`)}, q, ${HEADLINE})` : sql`''`} as snippet,
             exists (select 1 from enrollments e where e.course_id = c.id and e.user_id = ${v.userId}) as enrolled,
             count(*) over ()::int as total
      from courses c, to_tsquery('english', ${tsquery}) q
      where c.search_vector @@ q and ${v.canSeeCourse(sql`c`)}
      order by ts_rank_cd(c.search_vector, q) desc, c.title
      limit ${Math.max(limit, 1)} offset ${offset}`);
    return section(rows, limit, (row) => ({ id: row.id, slug: row.slug, title: row.title, summary: row.summary, status: row.status, snippet: row.snippet, enrolled: row.enrolled }));
  }

  private async lessons(tx: Tx, tsquery: string, v: Viewer, limit: number, offset: number): Promise<SearchSection<SearchLessonHit>> {
    const rows = await tx.execute<{ id: string; course_slug: string; course_title: string; title: string; kind: SearchLessonHit['kind']; snippet: string; locked: boolean; total: number }>(sql`
      select l.id, c.slug as course_slug, c.title as course_title, l.title, l.kind,
             ${limit ? sql`ts_headline('english', ${plain(sql`l.summary || ' ' || l.notes`)}, q, ${HEADLINE})` : sql`''`} as snippet,
             not (${v.canEditCourse(sql`c`)} or (c.status = 'published' and l.status = 'published' and
                  (l.is_preview or exists (select 1 from enrollments e where e.course_id = c.id and e.user_id = ${v.userId})))) as locked,
             count(*) over ()::int as total
      from lessons l join courses c on c.id = l.course_id, to_tsquery('english', ${tsquery}) q
      where l.search_vector @@ q and ${v.canSeeCourse(sql`c`)} and (l.status = 'published' or ${v.canEditCourse(sql`c`)})
      order by ts_rank_cd(l.search_vector, q) desc, l.title
      limit ${Math.max(limit, 1)} offset ${offset}`);
    return section(rows, limit, (row) => ({ id: row.id, courseSlug: row.course_slug, courseTitle: row.course_title, title: row.title, kind: row.kind, snippet: row.snippet, locked: row.locked }));
  }

  private async discussions(tx: Tx, tsquery: string, v: Viewer, limit: number, offset: number): Promise<SearchSection<SearchDiscussionHit>> {
    const rows = await tx.execute<{
      id: string;
      thread_id: string;
      course_slug: string;
      course_title: string;
      lesson_id: string | null;
      lesson_title: string | null;
      title: string | null;
      snippet: string;
      author_name: string | null;
      created_at: string;
      total: number;
    }>(sql`
      select p.id, coalesce(p.parent_id, p.id) as thread_id, c.slug as course_slug, c.title as course_title,
             p.lesson_id, l.title as lesson_title, coalesce(p.title, t.title) as title,
             ${limit ? sql`ts_headline('english', ${plain(sql`p.body`)}, q, ${HEADLINE})` : sql`''`} as snippet,
             u.name as author_name, p.created_at::text as created_at,
             count(*) over ()::int as total
      from discussion_posts p
      join courses c on c.id = p.course_id
      left join discussion_posts t on t.id = p.parent_id
      left join lessons l on l.id = p.lesson_id
      left join users u on u.id = p.author_id,
      to_tsquery('english', ${tsquery}) q
      where p.search_vector @@ q and p.status = 'visible' and (t.id is null or t.status <> 'hidden')
        and ${v.canReadDiscussions(sql`c`)}
        and (l.id is null or l.status = 'published' or ${v.canEditCourse(sql`c`)})
      order by ts_rank_cd(p.search_vector, q) desc, p.created_at desc
      limit ${Math.max(limit, 1)} offset ${offset}`);
    return section(rows, limit, (row) => ({
      id: row.id,
      threadId: row.thread_id,
      courseSlug: row.course_slug,
      courseTitle: row.course_title,
      lessonId: row.lesson_id,
      lessonTitle: row.lesson_title,
      title: row.title,
      snippet: row.snippet,
      authorName: row.author_name,
      createdAt: new Date(row.created_at).toISOString(),
    }));
  }
}

interface Viewer {
  userId: string;
  canEditCourse: (course: SQL) => SQL;
  canSeeCourse: (course: SQL) => SQL;
  canReadDiscussions: (course: SQL) => SQL;
}

/** The browsing rules (courses/course-access.ts) as SQL over a course row, for this viewer. */
function viewerSql(school: SchoolContext, userId: string): Viewer {
  const admin = ROLE_RANK[school.role] >= ROLE_RANK.admin;
  const instructor = school.role === 'instructor';
  const canEditCourse = (c: SQL) => sql`(${admin} or (${instructor} and ${c}.created_by = ${userId}))`;
  return {
    userId,
    canEditCourse,
    canSeeCourse: (c) => sql`(${c}.status = 'published' or ${canEditCourse(c)})`,
    canReadDiscussions: (c) =>
      sql`(${canEditCourse(c)} or (${c}.status = 'published' and exists (select 1 from enrollments e where e.course_id = ${c}.id and e.user_id = ${userId})))`,
  };
}

function section<Row extends { total: number }, Hit>(rows: Row[], limit: number, map: (row: Row) => Hit): SearchSection<Hit> {
  return { items: limit ? rows.map(map) : [], total: Math.min(rows[0]?.total ?? 0, 500) };
}
