import { useEffect, useRef, useState } from 'react';
import { m } from 'motion/react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { searchQuery } from '@grand/contracts';

import Badge from '../components/Badge.jsx';
import Breadcrumbs from '../components/Breadcrumbs.jsx';
import Button from '../components/Button.jsx';
import Icon from '../components/Icon.jsx';
import RequireAuth from '../components/RequireAuth.jsx';
import SchoolGate from '../components/SchoolGate.jsx';
import { Block } from '../components/Skeleton.jsx';
import Snippet from '../components/Snippet.jsx';
import { EmptyState, ErrorState } from '../components/States.jsx';
import { LESSON_KINDS } from '../lib/courses.js';
import { plural, timeAgo } from '../lib/format.js';
import { issuesByField } from '../lib/forms.js';
import {
  MAX_QUERY,
  PAGE_LIMIT,
  PREVIEW_LIMIT,
  SEARCH_TABS,
  cleanQuery,
  countLabel,
  courseHitPath,
  discussionHitPath,
  discussionHitTitle,
  lessonHitPath,
  nextOffset,
  searchKeys,
  searchPath,
  searchSchool,
  totalOf,
} from '../lib/search.js';
import { useDocumentTitle } from '../lib/useDocumentTitle.js';
import styles from './SchoolSearch.module.scss';

const SECTION_NOUNS = { courses: ['course', 'courses'], lessons: ['lesson', 'lessons'], discussions: ['discussion', 'discussions'] };

function CourseHit({ slug, hit }) {
  return (
    <li className={styles.hit}>
      <span className={styles.hitIcon} aria-hidden="true">
        <Icon name="layers" size={20} />
      </span>
      <div className={styles.hitText}>
        <h3 className={styles.hitTitle}>
          <Link to={courseHitPath(slug, hit)}>{hit.title}</Link>
        </h3>
        <p className={styles.hitMeta}>
          <span>Course</span>
          {hit.enrolled && (
            <Badge tone="success" icon="check">
              Enrolled
            </Badge>
          )}
          {hit.status === 'draft' && <Badge tone="warning">Draft</Badge>}
          {hit.status === 'archived' && <Badge>Archived</Badge>}
        </p>
        {hit.snippet ? <Snippet text={hit.snippet} className={styles.snippet} /> : hit.summary && <p className={styles.snippet}>{hit.summary}</p>}
      </div>
    </li>
  );
}

function LessonHit({ slug, hit }) {
  const kind = LESSON_KINDS[hit.kind] ?? LESSON_KINDS.lesson;
  return (
    <li className={styles.hit} data-locked={hit.locked || undefined}>
      <span className={styles.hitIcon} aria-hidden="true">
        <Icon name={kind.icon} size={20} />
      </span>
      <div className={styles.hitText}>
        <h3 className={styles.hitTitle}>
          <Link to={lessonHitPath(slug, hit)}>
            {hit.title}
            {hit.locked && <span className="visually-hidden"> (locked)</span>}
          </Link>
          {hit.locked && <Icon name="lock" size={15} className={styles.lock} />}
        </h3>
        <p className={styles.hitMeta}>
          <span>{kind.label}</span>
          <span aria-hidden="true">·</span>
          <span>{hit.courseTitle}</span>
          {hit.locked && <span className={styles.lockNote}>Enroll to open</span>}
        </p>
        {hit.snippet && <Snippet text={hit.snippet} className={styles.snippet} />}
      </div>
    </li>
  );
}

function DiscussionHit({ slug, hit }) {
  return (
    <li className={styles.hit}>
      <span className={styles.hitIcon} aria-hidden="true">
        <Icon name={hit.lessonId ? 'message' : 'users'} size={20} />
      </span>
      <div className={styles.hitText}>
        <h3 className={styles.hitTitle}>
          <Link to={discussionHitPath(slug, hit)}>{discussionHitTitle(hit)}</Link>
        </h3>
        <p className={styles.hitMeta}>
          <span>{hit.id === hit.threadId ? (hit.lessonId ? 'Comment' : 'Thread') : 'Reply'}</span>
          <span aria-hidden="true">·</span>
          <span>{hit.courseTitle}</span>
          {hit.authorName && (
            <>
              <span aria-hidden="true">·</span>
              <span>{hit.authorName}</span>
            </>
          )}
          {hit.createdAt && (
            <>
              <span aria-hidden="true">·</span>
              <time dateTime={hit.createdAt}>{timeAgo(hit.createdAt)}</time>
            </>
          )}
        </p>
        {hit.snippet && <Snippet text={hit.snippet} className={styles.snippet} />}
      </div>
    </li>
  );
}

const HIT = { courses: CourseHit, lessons: LessonHit, discussions: DiscussionHit };

function HitList({ slug, type, items }) {
  const Hit = HIT[type];
  return (
    <ul className={styles.hits}>
      {items.map((hit) => (
        <Hit key={hit.id} slug={slug} hit={hit} />
      ))}
    </ul>
  );
}

function ResultsSkeleton() {
  return (
    <div className={styles.hits} aria-hidden="true">
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} className={styles.hit}>
          <Block width="40px" height="40px" radius="var(--radius-md)" />
          <div className={styles.hitText}>
            <Block width="min(22rem, 70%)" height="1.1rem" />
            <Block width="min(30rem, 90%)" height="0.9rem" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** "All": a few of each kind, each with the way to the rest. */
function Overview({ slug, q, query }) {
  if (query.isPending) return <ResultsSkeleton />;
  if (query.isError) return <ErrorState title="Couldn't search" error={query.error} onRetry={() => query.refetch()} />;
  const results = query.data;
  if (!totalOf(results)) return <NoResults slug={slug} q={q} />;
  return (
    <div className={styles.sections}>
      {['courses', 'lessons', 'discussions'].map((type) => {
        const section = results[type];
        if (!section.total) return null;
        const [one, many] = SECTION_NOUNS[type];
        return (
          <section key={type} className={styles.section} aria-labelledby={`results-${type}`}>
            <header className={styles.sectionHead}>
              <h2 id={`results-${type}`} className={styles.sectionTitle}>
                {SEARCH_TABS.find((tab) => tab.key === type).label}
                <span className={`${styles.sectionCount} tabular`}>{countLabel(section.total)}</span>
              </h2>
              {section.total > section.items.length && (
                <Link to={searchPath(slug, q, type)} className={styles.more}>
                  See all {countLabel(section.total)} {section.total === 1 ? one : many}
                  <Icon name="chevronRight" size={16} />
                </Link>
              )}
            </header>
            <HitList slug={slug} type={type} items={section.items} />
          </section>
        );
      })}
    </div>
  );
}

/** One kind, a page at a time. */
function OneKind({ slug, q, type }) {
  const [loaded, setLoaded] = useState('');
  const firstNew = useRef(null);
  const list = useInfiniteQuery({
    queryKey: searchKeys.list(slug, q, type),
    queryFn: ({ pageParam, signal }) => searchSchool(slug, { q, type, limit: PAGE_LIMIT, offset: pageParam }, signal),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => nextOffset(last, pages, type),
    staleTime: 30_000,
  });
  const items = list.data?.pages.flatMap((page) => page[type].items) ?? [];
  const total = list.data?.pages[0]?.[type].total ?? 0;
  const [one, many] = SECTION_NOUNS[type];

  const loadMore = async () => {
    const before = items.length;
    const result = await list.fetchNextPage();
    const now = result.data?.pages.flatMap((page) => page[type].items).length ?? before;
    setLoaded(`${plural(now - before, `more ${one}`, `more ${many}`)} loaded.`);
    // Keyboard users carry on from the first of the new ones.
    requestAnimationFrame(() => firstNew.current?.querySelectorAll(`.${styles.hit}`)[before]?.querySelector('a')?.focus());
  };

  if (list.isPending) return <ResultsSkeleton />;
  if (list.isError) return <ErrorState title="Couldn't search" error={list.error} onRetry={() => list.refetch()} />;
  if (!items.length) return <NoResults slug={slug} q={q} type={type} />;
  return (
    <div ref={firstNew}>
      <p className={`${styles.count} tabular`}>
        {items.length < total ? `Showing ${items.length} of ${countLabel(total)} ${many}` : plural(items.length, one, many)}
      </p>
      <HitList slug={slug} type={type} items={items} />
      {list.hasNextPage && (
        <div className={styles.loadMore}>
          <Button icon="chevronDown" busy={list.isFetchingNextPage} onClick={loadMore}>
            Load more
          </Button>
        </div>
      )}
      <p className="visually-hidden" aria-live="polite">
        {loaded}
      </p>
    </div>
  );
}

function NoResults({ slug, q, type }) {
  const where = type ? SEARCH_TABS.find((tab) => tab.key === type).label.toLowerCase() : 'courses, lessons or discussions';
  return (
    <EmptyState
      icon="search"
      title={`No results for “${q}”`}
      action={
        type && (
          <Button variant="secondary" icon="search" to={searchPath(slug, q)}>
            Search everything
          </Button>
        )
      }
    >
      Nothing in {where} matches. Check the spelling, or try fewer or more general words.
    </EmptyState>
  );
}

/**
 * Search results (/s/:slug/search?q=&type=): the school's courses, lessons and discussions that
 * match, as far as this person may see them, under All, Courses, Lessons and Discussions (with how
 * many each has). Matched words are highlighted; lessons not open yet are marked with a lock.
 */
function SearchView({ school }) {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const slug = school.slug;
  const q = cleanQuery(params.get('q'));
  const type = SEARCH_TABS.some((tab) => tab.key === params.get('type')) ? params.get('type') : 'all';
  const [value, setValue] = useState(q);
  const [error, setError] = useState(null);
  const input = useRef(null);
  const valid = searchQuery.safeParse({ q }).success;
  useDocumentTitle(q ? `“${q}” · Search ${school.name}` : `Search ${school.name}`);

  // Follow the address (back and forward).
  useEffect(() => setValue(q), [q]);
  // Arriving with nothing to search (from the top bar's button on phones): the field, ready to
  // type. After the app has moved focus to the new page's content, which it does as it arrives.
  useEffect(() => {
    if (q) return undefined;
    const frame = requestAnimationFrame(() => input.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [q]);

  const preview = useQuery({
    queryKey: searchKeys.preview(slug, q),
    queryFn: ({ signal }) => searchSchool(slug, { q, type: 'all', limit: PREVIEW_LIMIT }, signal),
    enabled: valid,
    staleTime: 30_000,
  });

  const submit = (event) => {
    event.preventDefault();
    const clean = cleanQuery(value);
    const found = issuesByField(searchQuery.safeParse({ q: clean }));
    if (found.q) {
      setError(found.q);
      input.current?.focus();
      return;
    }
    setError(null);
    navigate(searchPath(slug, clean, type));
  };

  return (
    <div className={`page ${styles.page}`}>
      <Breadcrumbs items={[{ label: school.name, to: `/s/${slug}` }, { label: 'Search' }]} />
      <header className={styles.header}>
        <h1 className={styles.title}>{q && valid ? <>Results for “{q}”</> : `Search ${school.name}`}</h1>
        <form role="search" className={styles.form} onSubmit={submit} noValidate>
          <div className={`${styles.field} ${error ? styles.invalid : ''}`}>
            <Icon name="search" size={20} className={styles.fieldIcon} />
            <input
              ref={input}
              type="search"
              name="q"
              value={value}
              maxLength={MAX_QUERY}
              placeholder="Courses, lessons, discussions…"
              aria-label={`Search ${school.name}`}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? 'search-error' : undefined}
              autoComplete="off"
              spellCheck="false"
              enterKeyHint="search"
              onChange={(event) => {
                setValue(event.target.value);
                if (error && cleanQuery(event.target.value).length >= 2) setError(null);
              }}
            />
            <Button type="submit" variant="primary" size="sm" className={styles.submit}>
              Search
            </Button>
          </div>
          {error && (
            <p id="search-error" className={styles.error}>
              <Icon name="alert" size={15} />
              {error}
            </p>
          )}
        </form>
      </header>

      {valid && (
        <nav className={styles.tabs} aria-label="Kinds of results">
          {SEARCH_TABS.map((tab) => {
            const current = tab.key === type;
            const total = tab.key === 'all' ? totalOf(preview.data) : preview.data?.[tab.key].total;
            return (
              <Link key={tab.key} to={searchPath(slug, q, tab.key)} replace className={styles.tab} aria-current={current ? 'page' : undefined}>
                {current && <m.span layoutId="search-tab" className={styles.tabPill} aria-hidden="true" />}
                {tab.icon && <Icon name={tab.icon} size={16} />}
                <span>{tab.label}</span>
                {preview.data && (
                  <span className={`${styles.tabCount} tabular`}>
                    <span className="visually-hidden">: </span>
                    {countLabel(total)}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
      )}

      <div className={styles.body}>
        {!q ? (
          <EmptyState icon="search" title={`Search ${school.name}`}>
            Find courses, lessons and discussions. Words match their other forms, so “scale” finds “scales” too.
          </EmptyState>
        ) : !valid ? (
          <EmptyState icon="search" title="Type a little more">
            Searches need at least 2 characters.
          </EmptyState>
        ) : type === 'all' ? (
          <Overview slug={slug} q={q} query={preview} />
        ) : (
          <OneKind key={`${q}/${type}`} slug={slug} q={q} type={type} />
        )}
      </div>
    </div>
  );
}

export default function SchoolSearch() {
  const { slug = '' } = useParams();
  return (
    <RequireAuth>
      <SchoolGate slug={slug} fallback={<div className="page" aria-busy="true" />}>
        {(school) => <SearchView key={slug} school={school} />}
      </SchoolGate>
    </RequireAuth>
  );
}
