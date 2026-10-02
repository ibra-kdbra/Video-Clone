import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { courseSlug as courseSlugSchema, uuid } from '@grand/contracts';

import Badge from '../components/Badge.jsx';
import Breadcrumbs from '../components/Breadcrumbs.jsx';
import DiscussionPost from '../components/DiscussionPost.jsx';
import Icon from '../components/Icon.jsx';
import PostComposer from '../components/PostComposer.jsx';
import RequireAuth from '../components/RequireAuth.jsx';
import SchoolGate from '../components/SchoolGate.jsx';
import { Block } from '../components/Skeleton.jsx';
import { ErrorState } from '../components/States.jsx';
import { coursePath, getCourse, keys, lessonPath } from '../lib/courses.js';
import {
  addReply,
  addReplyToPages,
  canReply,
  commentPath,
  discussionKeys,
  discussionsPath,
  getThread,
  patchThread,
  removeFromThread,
  replyTo,
} from '../lib/discussions.js';
import { plural } from '../lib/format.js';
import { errorMessage } from '../lib/forms.js';
import { toast } from '../lib/toast.js';
import { useCourseWatch } from '../lib/useCourseWatch.js';
import { useDocumentTitle } from '../lib/useDocumentTitle.js';
import { usePostActions } from '../lib/usePostActions.js';
import NotFound from './NotFound.jsx';
import styles from './Discussions.module.scss';

const noRetryOn4xx = (failures, error) => failures < 1 && (error?.status === 0 || error?.status >= 500);

function ThreadSkeleton() {
  return (
    <div className={styles.thread} aria-busy="true">
      <Block width="min(30rem, 85%)" height="2.4rem" />
      <Block height="10rem" radius="var(--radius-lg)" />
      <Block height="6rem" radius="var(--radius-lg)" />
    </div>
  );
}

/**
 * A thread (/s/:slug/c/:course/discussions/:id): its first post, then the replies, oldest first,
 * and a box to reply (closed when it's locked, except for moderators). It's also how a lesson
 * comment opens on its own. `?post=` brings one reply into view. Changes by others arrive live.
 */
function ThreadView({ school, courseSlug, threadId }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState('');
  const slug = school.slug;
  const key = discussionKeys.thread(slug, courseSlug, threadId);
  const focusPost = params.get('post');

  const course = useQuery({
    queryKey: keys.course(slug, courseSlug),
    queryFn: ({ signal }) => getCourse(slug, courseSlug, signal),
    staleTime: 30_000,
    retry: noRetryOn4xx,
  });
  const thread = useQuery({ queryKey: key, queryFn: ({ signal }) => getThread(slug, courseSlug, threadId, signal), staleTime: 15_000, retry: noRetryOn4xx });
  const c = course.data;
  const t = thread.data;
  const gone = t?.status === 'deleted';
  const title = t ? (gone ? 'Deleted thread' : (t.title ?? (t.lesson ? `Comment on ${t.lesson.title}` : 'Comment'))) : null;
  useDocumentTitle(title ? `${title} · ${c?.title ?? 'Discussion'}` : 'Discussion');
  useCourseWatch({
    slug,
    courseSlug,
    courseId: c?.id ?? t?.courseId,
    onChange: (event) => {
      if (event.threadId === threadId && event.postId === threadId && event.change === 'removed') setStatus('This thread was deleted.');
    },
  });

  const cache = {
    patch: (postId, patch) => queryClient.setQueryData(key, (current) => patchThread(current, postId, patch)),
    remove: (postId) => {
      const next = removeFromThread(queryClient.getQueryData(key), postId);
      if (next === null) {
        // The thread itself, with no replies: gone, so back to the list.
        queryClient.removeQueries({ queryKey: key, exact: true });
        navigate(t?.lessonId ? lessonPath(slug, courseSlug, t.lessonId) : discussionsPath(slug, courseSlug), { replace: true });
        return;
      }
      queryClient.setQueryData(key, next);
    },
  };
  const actions = usePostActions({ slug, courseSlug, cache });

  const reply = async (body) => {
    setSending(true);
    try {
      const posted = await replyTo(slug, courseSlug, threadId, { body });
      queryClient.setQueryData(key, (current) => addReply(current, posted));
      queryClient.setQueriesData({ queryKey: discussionKeys.lists(slug, courseSlug) }, (data) => addReplyToPages(data, posted));
      queryClient.invalidateQueries({ queryKey: discussionKeys.lists(slug, courseSlug), refetchType: 'none' });
      setStatus('Reply posted.');
      return true;
    } catch (error) {
      toast(errorMessage(error), { tone: 'error' });
      return false;
    } finally {
      setSending(false);
    }
  };

  if (thread.isError && thread.error.status === 404)
    return (
      <NotFound title="Thread not found">
        This thread doesn't exist, or was removed. <Link to={discussionsPath(slug, courseSlug)}>Back to the discussion</Link>.
      </NotFound>
    );

  const crumbs = [
    { label: school.name, to: `/s/${slug}` },
    { label: c?.title ?? 'Course', to: coursePath(slug, courseSlug) },
    t?.lesson ? { label: t.lesson.title, to: lessonPath(slug, courseSlug, t.lesson.id) } : { label: 'Discussion', to: discussionsPath(slug, courseSlug) },
    { label: title ?? 'Thread' },
  ];

  const replies = t?.replies ?? [];
  const open = canReply(t);

  return (
    <div className={`page ${styles.page}`}>
      <Breadcrumbs items={crumbs} />
      {thread.isPending ? (
        <ThreadSkeleton />
      ) : thread.isError ? (
        <ErrorState titleAs="h1" title="Couldn't load this thread" error={thread.error} onRetry={() => thread.refetch()} />
      ) : (
        <div className={styles.thread}>
          <header className={styles.titles}>
            {t.lesson && (
              <Link to={commentPath(slug, courseSlug, t.lesson.id, threadId)} className={styles.context}>
                <Icon name="film" size={16} />
                Under the lesson “{t.lesson.title}”
              </Link>
            )}
            <h1 className={styles.title}>{title}</h1>
            {(t.answered || t.locked || t.pinned) && (
              <p className={styles.threadFlags}>
                {t.answered && (
                  <Badge tone="success" icon="checkCircle">
                    Answered
                  </Badge>
                )}
                {t.pinned && (
                  <Badge tone="accent" icon="pin">
                    Pinned
                  </Badge>
                )}
                {t.locked && (
                  <Badge icon="lock" tone="neutral">
                    Locked
                  </Badge>
                )}
              </p>
            )}
          </header>

          <div className={styles.first}>
            <DiscussionPost post={t} topLevel actions={actions} highlight={focusPost === threadId} flags={false} />
          </div>

          <section className={styles.thread} aria-labelledby="replies-title">
            <h2 id="replies-title" className={styles.repliesHead}>
              {replies.length ? plural(replies.length, 'reply', 'replies') : 'No replies yet'}
            </h2>
            {replies.length > 0 && (
              <ol className={styles.replyList}>
                {replies.map((item) => (
                  <li key={item.id}>
                    <DiscussionPost post={item} topLevel={false} actions={actions} highlight={focusPost === item.id} />
                  </li>
                ))}
              </ol>
            )}

            {t.locked && (
              <p className={styles.notice}>
                <Icon name="lock" size={18} />
                <span>{t.canModerate ? 'This thread is locked: only moderators can reply.' : 'This thread is locked: it doesn’t take new replies.'}</span>
              </p>
            )}
            {open ? (
              <div className={styles.replyBox}>
                <h3 className={styles.replyTitle}>Your reply</h3>
                <PostComposer
                  label="Your reply"
                  placeholder="Write a reply…"
                  submitLabel="Reply"
                  busy={sending}
                  onSubmit={reply}
                  hint="Markdown works here. Ctrl+Enter sends."
                />
              </div>
            ) : (
              !t.locked &&
              t.status !== 'visible' && (
                <p className={styles.notice}>
                  <Icon name="eyeOff" size={18} />
                  <span>
                    {gone ? 'The first post was deleted, so this thread doesn’t take new replies.' : 'This thread is hidden, so it doesn’t take new replies.'}
                  </span>
                </p>
              )
            )}
          </section>
        </div>
      )}
      <p className="visually-hidden" aria-live="polite">
        {status}
      </p>
    </div>
  );
}

export default function Thread() {
  const { slug = '', courseSlug = '', threadId = '' } = useParams();
  const parsed = courseSlugSchema.safeParse(courseSlug);
  if (!parsed.success || !uuid.safeParse(threadId).success) return <NotFound title="Thread not found">This address doesn't point to a thread.</NotFound>;
  if (parsed.data !== courseSlug) return <Navigate to={`${discussionsPath(slug, parsed.data)}/${threadId}`} replace />;
  return (
    <RequireAuth>
      <SchoolGate slug={slug} fallback={<div className="page" aria-busy="true" />}>
        {(school) => <ThreadView key={`${slug}/${courseSlug}/${threadId}`} school={school} courseSlug={courseSlug} threadId={threadId} />}
      </SchoolGate>
    </RequireAuth>
  );
}
