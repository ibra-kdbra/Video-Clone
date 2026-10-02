import { useEffect, useRef, useState } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { courseSlug as courseSlugSchema, newThreadInput } from '@grand/contracts';

import Badge from '../components/Badge.jsx';
import Breadcrumbs from '../components/Breadcrumbs.jsx';
import Button from '../components/Button.jsx';
import CourseTabs from '../components/CourseTabs.jsx';
import Dialog from '../components/Dialog.jsx';
import { FormAlert, SelectField, TextField } from '../components/Field.jsx';
import Icon from '../components/Icon.jsx';
import MarkdownField from '../components/MarkdownField.jsx';
import RequireAuth from '../components/RequireAuth.jsx';
import SchoolGate from '../components/SchoolGate.jsx';
import { Block } from '../components/Skeleton.jsx';
import { EmptyState, ErrorState } from '../components/States.jsx';
import { coursePath, enroll, getCourse, keys } from '../lib/courses.js';
import {
  FILTERS,
  SORT_OPTIONS,
  THREADS_PAGE,
  addToPages,
  createThread,
  discussionKeys,
  discussionsPath,
  getThreads,
  reportsPath,
  threadPath,
} from '../lib/discussions.js';
import { plural, timeAgo } from '../lib/format.js';
import { errorMessage } from '../lib/forms.js';
import { toast } from '../lib/toast.js';
import { useCourseWatch } from '../lib/useCourseWatch.js';
import { useDocumentTitle } from '../lib/useDocumentTitle.js';
import { useForm } from '../lib/useForm.js';
import { useOpenReports } from '../lib/useOpenReports.js';
import NotFound from './NotFound.jsx';
import styles from './Discussions.module.scss';

const noRetryOn4xx = (failures, error) => failures < 1 && (error?.status === 0 || error?.status >= 500);

/** A line of a post's text, as plain words, for the list: Markdown's links, list marks and emphasis go. */
const excerpt = (body) =>
  String(body ?? '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(?:[-*+]|\d+[.)]|#{1,6}|>)\s+/gm, '')
    .replace(/[*_`~]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 220);

/** A new thread: a title and the first post. */
function NewThreadDialog({ open, onClose, slug, course }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const form = useForm(newThreadInput, { title: '', body: '' }, ['title', 'body']);

  const submit = async (event) => {
    event.preventDefault();
    const input = form.validate();
    if (!input) return;
    setBusy(true);
    try {
      const thread = await createThread(slug, course.slug, input);
      queryClient.setQueryData(discussionKeys.thread(slug, course.slug, thread.id), thread);
      queryClient.setQueriesData({ queryKey: discussionKeys.lists(slug, course.slug) }, (data) => addToPages(data, thread));
      form.update({ title: '', body: '' });
      onClose();
      toast('Thread posted');
      navigate(threadPath(slug, course.slug, thread.id));
    } catch (error) {
      form.fail(error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      title="Start a thread"
      description={`Ask a question or start a conversation with everyone in ${course.title}.`}
      busy={busy}
      onClose={onClose}
      className={styles.dialog}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="new-thread" icon="send" busy={busy}>
            Post thread
          </Button>
        </>
      }
    >
      <form id="new-thread" className={styles.form} onSubmit={submit} noValidate>
        <FormAlert>{form.errors['']}</FormAlert>
        <TextField label="Title" placeholder="What's it about?" maxLength={150} autoComplete="off" {...form.bind('title')} />
        <MarkdownField label="Post" rows={7} {...form.bind('body')} />
      </form>
    </Dialog>
  );
}

/** One thread in the list: its title and first words, who started it, and how it's going. */
function ThreadRow({ slug, courseSlug, thread, ref }) {
  const gone = thread.status === 'deleted';
  const hidden = thread.status === 'hidden';
  const title = gone ? 'Deleted thread' : (thread.title ?? 'Untitled');
  return (
    <li ref={ref} className={styles.row} data-pinned={thread.pinned || undefined} data-gone={gone || undefined}>
      <div className={styles.rowMain}>
        <p className={styles.rowFlags}>
          {thread.pinned && (
            <Badge tone="accent" icon="pin">
              Pinned
            </Badge>
          )}
          {thread.answered && (
            <Badge tone="success" icon="checkCircle">
              Answered
            </Badge>
          )}
          {thread.locked && (
            <Badge icon="lock" tone="neutral">
              Locked
            </Badge>
          )}
          {hidden && (
            <Badge icon="eyeOff" tone="warning">
              Hidden
            </Badge>
          )}
          {thread.canModerate && thread.reportCount > 0 && (
            <Badge icon="flag" tone="danger">
              {plural(thread.reportCount, 'report')}
            </Badge>
          )}
        </p>
        <h2 className={styles.rowTitle}>
          <Link to={threadPath(slug, courseSlug, thread.id)}>{title}</Link>
        </h2>
        {!gone && thread.body && <p className={styles.rowExcerpt}>{excerpt(thread.body)}</p>}
        <p className={styles.rowMeta}>
          {thread.author && (
            <>
              <span className={styles.rowAuthor}>{thread.author.name}</span>
              {thread.author.instructor && <Badge tone="teal">Instructor</Badge>}
              <span aria-hidden="true">·</span>
            </>
          )}
          <span>
            Started <time dateTime={thread.createdAt}>{timeAgo(thread.createdAt)}</time>
          </span>
          {thread.lastActivityAt !== thread.createdAt && (
            <>
              <span aria-hidden="true">·</span>
              <span>
                Last reply <time dateTime={thread.lastActivityAt}>{timeAgo(thread.lastActivityAt)}</time>
              </span>
            </>
          )}
        </p>
      </div>
      <dl className={styles.rowStats}>
        <div>
          <dt>
            <Icon name="message" size={16} />
            <span className="visually-hidden">Replies</span>
          </dt>
          <dd className="tabular">{thread.replyCount}</dd>
        </div>
        <div>
          <dt>
            <Icon name="thumbUp" size={16} />
            <span className="visually-hidden">Found helpful</span>
          </dt>
          <dd className="tabular">{thread.voteCount}</dd>
        </div>
      </dl>
    </li>
  );
}

const EMPTY = {
  all: ['No threads yet', 'Ask a question or start a conversation: everyone in the course can join in.'],
  unanswered: ['Nothing waiting for an answer', 'Every question here has an answer marked by an instructor.'],
  mine: ["You haven't joined in yet", 'Threads you start or reply to will be here.'],
};

/**
 * A course's discussion (/s/:slug/c/:course/discussions): its threads, pinned ones first, then by
 * recent activity, newest, or most helpful, filtered to all, those without an answer, or the
 * person's own; twenty at a time. Anyone taking part can start a thread; moderators have a way
 * to the reports waiting for them.
 */
function DiscussionsView({ school, courseSlug }) {
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [composing, setComposing] = useState(false);
  const [status, setStatus] = useState('');
  const slug = school.slug;
  const sort = SORT_OPTIONS.some((option) => option.value === params.get('sort')) ? params.get('sort') : 'activity';
  const filter = FILTERS.some((option) => option.key === params.get('filter')) ? params.get('filter') : 'all';
  const firstNew = useRef(null);
  const focusFrom = useRef(null);

  const course = useQuery({
    queryKey: keys.course(slug, courseSlug),
    queryFn: ({ signal }) => getCourse(slug, courseSlug, signal),
    staleTime: 30_000,
    retry: noRetryOn4xx,
  });
  const c = course.data;
  const member = Boolean(c && (c.enrolled || c.canEdit));
  useDocumentTitle(c ? `Discussion · ${c.title}` : 'Discussion');
  useCourseWatch({ slug, courseSlug, courseId: c?.id, enabled: member });
  const reports = useOpenReports(slug, courseSlug, Boolean(c?.canEdit));

  const list = useInfiniteQuery({
    queryKey: discussionKeys.list(slug, courseSlug, sort, filter),
    queryFn: ({ pageParam, signal }) => getThreads(slug, courseSlug, { sort, filter, cursor: pageParam, limit: THREADS_PAGE }, signal),
    initialPageParam: null,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: member,
    staleTime: 30_000,
    retry: noRetryOn4xx,
  });
  const items = list.data?.pages.flatMap((page) => page.items) ?? [];

  useEffect(() => {
    if (focusFrom.current === null || items.length <= focusFrom.current) return;
    focusFrom.current = null;
    firstNew.current?.querySelector('a')?.focus();
  }, [items.length]);

  const join = async () => {
    try {
      await enroll(slug, courseSlug);
      toast(`You're enrolled in ${c.title}`);
      queryClient.invalidateQueries({ queryKey: keys.course(slug, courseSlug) });
      queryClient.invalidateQueries({ queryKey: keys.courses(slug) });
    } catch (error) {
      toast(errorMessage(error), { tone: 'error' });
    }
  };

  const choose = (patch) => {
    const next = new URLSearchParams(params);
    for (const [name, value] of Object.entries(patch)) {
      if (value === 'activity' || value === 'all') next.delete(name);
      else next.set(name, value);
    }
    setParams(next, { replace: true });
  };

  if (course.isError && course.error.status === 404)
    return (
      <NotFound title="Course not found">
        This course doesn't exist, or isn't published yet. <Link to={`/s/${slug}`}>See {school.name}'s courses</Link>.
      </NotFound>
    );

  const waiting = reports.data?.length ?? 0;

  return (
    <div className={`page ${styles.page}`}>
      <Breadcrumbs
        items={[{ label: school.name, to: `/s/${slug}` }, { label: c?.title ?? 'Course', to: coursePath(slug, courseSlug) }, { label: 'Discussion' }]}
      />
      <header className={styles.header}>
        <div className={styles.titles}>
          <div className={styles.eyebrow}>{c ? c.title : <Block width="10rem" height="0.9rem" />}</div>
          <h1 className={styles.title}>Discussion</h1>
        </div>
        {member && (
          <div className={styles.actions}>
            {c.canEdit && (
              <Button variant={waiting ? 'secondary' : 'ghost'} icon="flag" to={reportsPath(slug, courseSlug)}>
                Reports{waiting > 0 && <span className={`${styles.count} tabular`}>{waiting}</span>}
              </Button>
            )}
            <Button variant="primary" icon="plus" onClick={() => setComposing(true)}>
              New thread
            </Button>
          </div>
        )}
      </header>
      {member && <CourseTabs slug={slug} course={c} current="discussion" />}

      {course.isPending ? (
        <Block height="12rem" radius="var(--radius-lg)" />
      ) : course.isError ? (
        <ErrorState title="Couldn't load this course" error={course.error} onRetry={() => course.refetch()} />
      ) : !member ? (
        <EmptyState
          icon="lock"
          title="Enroll to join the discussion"
          action={
            c.status === 'published' && (
              <Button variant="primary" icon="plus" onClick={join}>
                Enroll in {c.title}
              </Button>
            )
          }
        >
          The discussion is for the course's students and instructors.
        </EmptyState>
      ) : (
        <>
          <div className={styles.toolbar}>
            <nav className={styles.filters} aria-label="Show threads">
              {FILTERS.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  className={styles.filter}
                  aria-pressed={option.key === filter}
                  onClick={() => choose({ filter: option.key })}
                >
                  {option.label}
                </button>
              ))}
            </nav>
            <SelectField
              className={styles.sort}
              label="Sort threads"
              hideLabel
              value={sort}
              options={SORT_OPTIONS}
              onChange={(event) => choose({ sort: event.target.value })}
            />
          </div>

          {list.isPending ? (
            <div className={styles.list} aria-busy="true">
              {Array.from({ length: 4 }, (_, i) => (
                <div key={i} className={styles.skeleton}>
                  <Block width="min(26rem, 80%)" height="1.2rem" />
                  <Block width="min(36rem, 95%)" height="0.9rem" />
                </div>
              ))}
            </div>
          ) : list.isError ? (
            <ErrorState title="Couldn't load the discussion" error={list.error} onRetry={() => list.refetch()} />
          ) : items.length === 0 ? (
            <EmptyState
              icon="message"
              title={EMPTY[filter][0]}
              action={
                filter === 'all' && (
                  <Button variant="primary" icon="plus" onClick={() => setComposing(true)}>
                    Start the first thread
                  </Button>
                )
              }
            >
              {EMPTY[filter][1]}
            </EmptyState>
          ) : (
            <>
              <ul className={styles.list}>
                {items.map((thread, index) => (
                  <ThreadRow key={thread.id} ref={index === focusFrom.current ? firstNew : undefined} slug={slug} courseSlug={courseSlug} thread={thread} />
                ))}
              </ul>
              {list.hasNextPage && (
                <div className={styles.more}>
                  <Button
                    icon="chevronDown"
                    busy={list.isFetchingNextPage}
                    onClick={async () => {
                      focusFrom.current = items.length;
                      await list.fetchNextPage();
                      setStatus('More threads loaded.');
                    }}
                  >
                    Load more
                  </Button>
                </div>
              )}
            </>
          )}
          <NewThreadDialog open={composing} onClose={() => setComposing(false)} slug={slug} course={c} />
        </>
      )}
      <p className="visually-hidden" aria-live="polite">
        {status}
      </p>
    </div>
  );
}

export default function Discussions() {
  const { slug = '', courseSlug = '' } = useParams();
  const parsed = courseSlugSchema.safeParse(courseSlug);
  if (!parsed.success) return <NotFound title="Course not found">This address doesn't point to a course.</NotFound>;
  if (parsed.data !== courseSlug) return <Navigate to={discussionsPath(slug, parsed.data)} replace />;
  return (
    <RequireAuth>
      <SchoolGate slug={slug} fallback={<div className="page" aria-busy="true" />}>
        {(school) => <DiscussionsView key={`${slug}/${courseSlug}`} school={school} courseSlug={courseSlug} />}
      </SchoolGate>
    </RequireAuth>
  );
}
