import { useId, useState } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  COMMENTS_PAGE,
  SORT_OPTIONS,
  addReply,
  addReplyToPages,
  addToPages,
  canReply,
  createLessonComment,
  discussionKeys,
  getLessonComments,
  getThread,
  patchPages,
  patchThread,
  removeFromPages,
  removeFromThread,
  replyTo,
  visibleReplies,
} from '../lib/discussions.js';
import { plural } from '../lib/format.js';
import { errorMessage } from '../lib/forms.js';
import { toast } from '../lib/toast.js';
import { usePostActions } from '../lib/usePostActions.js';
import Button from './Button.jsx';
import DiscussionPost from './DiscussionPost.jsx';
import { SelectField } from './Field.jsx';
import Icon from './Icon.jsx';
import PostComposer from './PostComposer.jsx';
import { Block } from './Skeleton.jsx';
import { ErrorState } from './States.jsx';
import styles from './Discussion.module.scss';

/** A comment with its replies (three, then "Show N more"), and a box to reply when asked. */
function CommentThread({ comment, actions, onReply, highlight }) {
  const [expanded, setExpanded] = useState(false);
  const [replying, setReplying] = useState(false);
  const [sending, setSending] = useState(false);
  const { shown, more } = visibleReplies(comment.replies, { expanded });
  const open = canReply(comment);
  const listId = useId();

  return (
    <li className={styles.comment}>
      <DiscussionPost post={comment} topLevel actions={actions} highlight={highlight} onReply={open ? () => setReplying(true) : undefined}>
        {(shown.length > 0 || replying || comment.locked) && (
          <ul id={listId} className={styles.replies} aria-label={`Replies to ${comment.author?.name ?? 'this comment'}`}>
            {shown.map((reply) => (
              <li key={reply.id}>
                <DiscussionPost post={reply} topLevel={false} actions={actions} />
              </li>
            ))}
            {more > 0 && (
              <li>
                <button type="button" className={styles.showMore} aria-controls={listId} onClick={() => setExpanded(true)}>
                  <Icon name="chevronDown" size={16} />
                  Show {plural(more, 'more reply', 'more replies')}
                </button>
              </li>
            )}
            {comment.locked && (
              <li className={styles.end}>
                <Icon name="lock" size={14} />
                Replies are closed{comment.canModerate ? ', except for moderators' : ''}.
              </li>
            )}
            {replying && (
              <li>
                <PostComposer
                  label={`Reply to ${comment.author?.name ?? 'this comment'}`}
                  placeholder="Write a reply…"
                  submitLabel="Reply"
                  autoFocus
                  busy={sending}
                  onCancel={() => setReplying(false)}
                  onSubmit={async (body) => {
                    setSending(true);
                    const done = await onReply(comment, body);
                    setSending(false);
                    if (done) {
                      setReplying(false);
                      setExpanded(true);
                    }
                    return done;
                  }}
                />
              </li>
            )}
          </ul>
        )}
      </DiscussionPost>
    </li>
  );
}

/**
 * The comments under a lesson (for those who can read it): a box to add one, then the comments,
 * each with its replies, ten at a time. `focusId` (from `?comment=`) brings that comment into view
 * and marks it; when it isn't among those loaded, it's fetched and shown first.
 */
export default function LessonComments({ slug, courseSlug, lessonId, focusId = null }) {
  const queryClient = useQueryClient();
  const [sort, setSort] = useState('activity');
  const [posting, setPosting] = useState(false);
  const [status, setStatus] = useState('');
  const listKey = discussionKeys.comments(slug, courseSlug, lessonId, sort);
  const allKey = discussionKeys.lessonComments(slug, courseSlug, lessonId);

  const list = useInfiniteQuery({
    queryKey: listKey,
    queryFn: ({ pageParam, signal }) => getLessonComments(slug, courseSlug, lessonId, { sort, cursor: pageParam, limit: COMMENTS_PAGE }, signal),
    initialPageParam: null,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    staleTime: 30_000,
    retry: (failures, error) => failures < 1 && (error?.status === 0 || error?.status >= 500),
  });
  const items = list.data?.pages.flatMap((page) => page.items) ?? [];
  const inList = Boolean(focusId) && items.some((item) => item.id === focusId);
  const linked = useQuery({
    queryKey: discussionKeys.thread(slug, courseSlug, focusId),
    queryFn: ({ signal }) => getThread(slug, courseSlug, focusId, signal),
    enabled: Boolean(focusId) && list.isSuccess && !inList,
    staleTime: 30_000,
    retry: false,
  });
  const extra = !inList && linked.data?.lessonId === lessonId ? linked.data : null;

  const cache = {
    patch: (postId, patch) => {
      queryClient.setQueriesData({ queryKey: allKey }, (data) => patchPages(data, postId, patch));
      if (focusId) queryClient.setQueryData(discussionKeys.thread(slug, courseSlug, focusId), (thread) => patchThread(thread, postId, patch));
    },
    remove: (postId) => {
      queryClient.setQueriesData({ queryKey: allKey }, (data) => removeFromPages(data, postId));
      if (focusId) queryClient.setQueryData(discussionKeys.thread(slug, courseSlug, focusId), (thread) => removeFromThread(thread, postId) ?? undefined);
    },
  };
  const actions = usePostActions({ slug, courseSlug, cache });

  const add = async (body) => {
    setPosting(true);
    try {
      const comment = await createLessonComment(slug, courseSlug, lessonId, { body });
      queryClient.setQueryData(listKey, (data) => addToPages(data, { replies: [], answered: false, lesson: null, ...comment }));
      queryClient.invalidateQueries({ queryKey: allKey, refetchType: 'none' });
      setStatus('Comment posted.');
      return true;
    } catch (error) {
      toast(errorMessage(error), { tone: 'error' });
      return false;
    } finally {
      setPosting(false);
    }
  };

  const reply = async (comment, body) => {
    try {
      const posted = await replyTo(slug, courseSlug, comment.id, { body });
      queryClient.setQueriesData({ queryKey: allKey }, (data) => addReplyToPages(data, posted));
      queryClient.setQueryData(discussionKeys.thread(slug, courseSlug, comment.id), (thread) => addReply(thread, posted));
      setStatus('Reply posted.');
      return true;
    } catch (error) {
      toast(errorMessage(error), { tone: 'error' });
      return false;
    }
  };

  const refused = list.error?.status === 403;

  return (
    <section className={styles.comments} aria-labelledby="comments-title">
      <header className={styles.commentsHead}>
        <h2 id="comments-title" className={styles.commentsTitle}>
          <Icon name="message" size={22} />
          Comments
        </h2>
        {items.length > 1 && (
          <SelectField
            className={styles.sort}
            label="Sort comments"
            hideLabel
            value={sort}
            options={SORT_OPTIONS}
            onChange={(event) => setSort(event.target.value)}
          />
        )}
      </header>

      {refused ? (
        <p className={styles.notice}>
          <Icon name="lock" size={18} />
          <span>{errorMessage(list.error)}</span>
        </p>
      ) : list.isError ? (
        <ErrorState title="Couldn't load the comments" error={list.error} onRetry={() => list.refetch()} />
      ) : (
        <>
          <PostComposer
            label="Add a comment"
            placeholder="Ask a question or share a thought about this lesson…"
            submitLabel="Comment"
            busy={posting}
            onSubmit={add}
            compact
            hint="Markdown works here. Be kind: everyone in the course can read it."
          />
          {list.isPending ? (
            <div className={styles.commentList} aria-busy="true">
              <Block height="5rem" radius="var(--radius-md)" />
              <Block height="5rem" radius="var(--radius-md)" />
            </div>
          ) : (
            <>
              {extra && (
                <div className={styles.linked}>
                  <p className={styles.linkedLabel}>The comment you followed</p>
                  <ul className={styles.commentList}>
                    <CommentThread comment={extra} actions={actions} onReply={reply} highlight />
                  </ul>
                </div>
              )}
              {items.length === 0 && !extra ? (
                <p className={styles.end}>No comments yet. Start the conversation.</p>
              ) : (
                <ul className={styles.commentList}>
                  {items.map((comment) => (
                    <CommentThread key={comment.id} comment={comment} actions={actions} onReply={reply} highlight={comment.id === focusId} />
                  ))}
                </ul>
              )}
              {list.hasNextPage && (
                <div>
                  <Button
                    icon="chevronDown"
                    size="sm"
                    busy={list.isFetchingNextPage}
                    onClick={() => list.fetchNextPage().then(() => setStatus('More comments loaded.'))}
                  >
                    More comments
                  </Button>
                </div>
              )}
            </>
          )}
        </>
      )}
      <p className="visually-hidden" aria-live="polite">
        {status}
      </p>
    </section>
  );
}
