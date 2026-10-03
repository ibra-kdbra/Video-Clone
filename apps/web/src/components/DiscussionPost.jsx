import { useEffect, useId, useRef, useState } from 'react';
import { editPostInput } from '@grand/contracts';

import { postActions, postState } from '../lib/discussions.js';
import { timeAgo } from '../lib/format.js';
import { issuesByField } from '../lib/forms.js';
import Badge from './Badge.jsx';
import Button from './Button.jsx';
import ConfirmDialog from './ConfirmDialog.jsx';
import { TextAreaField, TextField } from './Field.jsx';
import Icon from './Icon.jsx';
import Markdown from './Markdown.jsx';
import Monogram from './Monogram.jsx';
import OverflowMenu from './OverflowMenu.jsx';
import ReportDialog from './ReportDialog.jsx';
import styles from './Discussion.module.scss';

/** Editing a post in place: its text (and a thread's title), checked as the API checks it. */
function EditForm({ post, withTitle, busy, onSave, onCancel }) {
  const [title, setTitle] = useState(post.title ?? '');
  const [body, setBody] = useState(post.body);
  const [errors, setErrors] = useState({});
  const titleRef = useRef(null);
  const bodyRef = useRef(null);

  useEffect(() => {
    (withTitle ? titleRef : bodyRef).current?.focus();
  }, [withTitle]);

  const submit = async (event) => {
    event.preventDefault();
    const result = editPostInput.safeParse(withTitle ? { title, body } : { body });
    const found = issuesByField(result);
    setErrors(found);
    if (!result.success) {
      (found.title ? titleRef : bodyRef).current?.focus();
      return;
    }
    if (await onSave(result.data)) onCancel();
  };

  return (
    <form className={styles.editForm} onSubmit={submit} noValidate>
      {withTitle && (
        <TextField ref={titleRef} label="Title" value={title} maxLength={150} error={errors.title} onChange={(event) => setTitle(event.target.value)} />
      )}
      <TextAreaField
        ref={bodyRef}
        label={withTitle ? 'Post' : 'Text'}
        hideLabel={!withTitle}
        value={body}
        rows={4}
        error={errors.body}
        onChange={(event) => setBody(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            onCancel();
          }
          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) submit(event);
        }}
      />
      <div className={styles.composerActions}>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" variant="primary" type="submit" busy={busy}>
          Save
        </Button>
      </div>
    </form>
  );
}

/** Who wrote it: their initials, name, "Instructor" for the course's editors, and when. */
function Byline({ post, titleId }) {
  const author = post.author;
  return (
    <div className={styles.byline}>
      <Monogram name={author?.name ?? '?'} seed={author?.id ?? 'gone'} size={34} round />
      <p className={styles.bylineText}>
        <span id={titleId} className={styles.author}>
          {author?.name ?? 'Former member'}
        </span>
        {author?.instructor && (
          <Badge tone="teal" className={styles.instructor}>
            Instructor
          </Badge>
        )}
        {post.mine && <span className={styles.you}>(you)</span>}
        <span className={styles.when}>
          <time dateTime={post.createdAt} title={new Date(post.createdAt).toLocaleString()}>
            {timeAgo(post.createdAt)}
          </time>
          {post.editedAt && (
            <span title={`Edited ${new Date(post.editedAt).toLocaleString()}`}>
              <span aria-hidden="true"> · </span>
              <span className="visually-hidden">, </span>
              edited
            </span>
          )}
        </span>
      </p>
    </div>
  );
}

/**
 * One post (a thread's first post, a lesson comment, or a reply): who wrote it and when, its text
 * (rendered as Markdown), and what this person can do with it: mark it helpful, reply, edit or
 * delete their own, report someone else's, and (moderators) pin, lock, hide or mark the answer.
 * Deleted posts and those hidden from this person are placeholders; a hidden post its author or a
 * moderator can still see says so. `highlight` brings it into view, marked, once (a deep link).
 * `flags={false}` leaves the pinned and locked badges to the page (a thread's own header).
 */
export default function DiscussionPost({ post, topLevel, actions, onReply, replyLabel = 'Reply', highlight = false, flags = true, children }) {
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [reporting, setReporting] = useState(false);
  const root = useRef(null);
  const titleId = useId();
  const state = postState(post);
  const can = postActions(post, { topLevel });
  const reported = Boolean(post.reported);
  const busy = actions.busy;

  useEffect(() => {
    if (!highlight) return;
    root.current?.scrollIntoView({ block: 'center', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    root.current?.focus({ preventScroll: true });
  }, [highlight]);

  const menu = [
    can.edit && { label: 'Edit', icon: 'edit', onSelect: () => setEditing(true) },
    can.pin && { label: post.pinned ? 'Unpin' : 'Pin to the top', icon: 'pin', onSelect: () => actions.moderate(post, { pinned: !post.pinned }) },
    can.lock && {
      label: post.locked ? 'Unlock replies' : 'Lock replies',
      icon: post.locked ? 'unlock' : 'lock',
      onSelect: () => actions.moderate(post, { locked: !post.locked }),
    },
    can.hide && {
      label: post.status === 'hidden' ? 'Show to everyone' : 'Hide',
      icon: post.status === 'hidden' ? 'eye' : 'eyeOff',
      onSelect: () => actions.moderate(post, { hidden: post.status !== 'hidden' }),
    },
    can.report && { label: 'Report', icon: 'flag', onSelect: () => setReporting(true) },
    can.delete && { label: 'Delete', icon: 'trash', tone: 'danger', onSelect: () => setConfirmDelete(true) },
  ].filter(Boolean);

  const gone = state === 'deleted' || state === 'hidden';

  return (
    <article
      ref={root}
      id={`post-${post.id}`}
      tabIndex={-1}
      className={styles.post}
      data-state={state}
      data-accepted={post.accepted || undefined}
      data-highlight={highlight || undefined}
      aria-labelledby={titleId}
    >
      <header className={styles.postHead}>
        {gone ? (
          <p className={styles.placeholderHead} id={titleId}>
            <Icon name={state === 'deleted' ? 'trash' : 'eyeOff'} size={16} />
            {state === 'deleted' ? 'This post was deleted' : 'Hidden by a moderator'}
          </p>
        ) : (
          <Byline post={post} titleId={titleId} />
        )}
        <div className={styles.flags}>
          {post.accepted && state !== 'deleted' && (
            <Badge tone="success" icon="checkCircle">
              Answer
            </Badge>
          )}
          {post.pinned && topLevel && flags && (
            <Badge tone="accent" icon="pin">
              Pinned
            </Badge>
          )}
          {post.locked && topLevel && flags && (
            <Badge tone="neutral" icon="lock">
              Locked
            </Badge>
          )}
          {post.canModerate && post.reportCount > 0 && (
            <Badge tone="danger" icon="flag">
              {post.reportCount} {post.reportCount === 1 ? 'report' : 'reports'}
            </Badge>
          )}
        </div>
      </header>

      {state === 'flagged' && (
        <p className={styles.flaggedNote}>
          <Icon name="eyeOff" size={16} />
          {post.mine && !post.canModerate
            ? 'A moderator hid this post. Only you and the course’s moderators can see it.'
            : 'Hidden by a moderator. Only its author and the course’s moderators can see it.'}
        </p>
      )}

      {!gone &&
        (editing ? (
          <EditForm
            post={post}
            withTitle={topLevel && post.title !== null}
            busy={busy === `edit:${post.id}`}
            onSave={(input) => actions.edit(post, input)}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <Markdown headingOffset={3} className={styles.postBody}>
            {post.body}
          </Markdown>
        ))}
      {gone && state === 'hidden' && <p className={styles.placeholderText}>A moderator hid this post.</p>}

      {!gone && !editing && (
        <footer className={styles.postActions}>
          <button
            type="button"
            className={styles.helpful}
            aria-pressed={post.voted}
            disabled={!can.vote}
            title={post.mine ? 'Others can mark your posts helpful' : !can.vote ? undefined : post.voted ? 'You found this helpful' : 'Mark as helpful'}
            onClick={() => actions.vote(post)}
          >
            <Icon name="thumbUp" size={16} />
            {post.voteCount > 0 ? (
              <>
                <span className="visually-hidden">Helpful: </span>
                <span className="tabular">{post.voteCount}</span>
              </>
            ) : (
              <span>Helpful</span>
            )}
          </button>
          {onReply && (
            <button type="button" className={styles.action} onClick={onReply}>
              <Icon name="reply" size={16} />
              {replyLabel}
            </button>
          )}
          {can.accept && (
            <button
              type="button"
              className={styles.action}
              data-on={post.accepted || undefined}
              aria-pressed={post.accepted}
              aria-busy={busy === `moderate:${post.id}` || undefined}
              onClick={() => busy !== `moderate:${post.id}` && actions.moderate(post, { accepted: !post.accepted })}
            >
              <Icon name="checkCircle" size={16} />
              {post.accepted ? 'Answer' : 'Mark as answer'}
            </button>
          )}
          {reported && (
            <span className={styles.reported}>
              <Icon name="flag" size={14} />
              Reported
            </span>
          )}
          {menu.length > 0 && (
            <span className={styles.menu}>
              <OverflowMenu label={`More actions for ${post.author?.name ?? 'this'}’s post`} items={menu} size="sm" />
            </span>
          )}
        </footer>
      )}

      {children}

      <ConfirmDialog
        open={confirmDelete}
        title="Delete this post?"
        confirmLabel="Delete"
        busy={busy === `delete:${post.id}`}
        onConfirm={async () => {
          if (await actions.remove(post)) setConfirmDelete(false);
        }}
        onClose={() => setConfirmDelete(false)}
      >
        <p>
          {post.replyCount > 0 && topLevel
            ? 'Its text goes, but the replies stay, under a note that it was deleted.'
            : 'It will be gone for everyone. This can’t be undone.'}
        </p>
      </ConfirmDialog>
      <ReportDialog
        open={reporting}
        busy={busy === `report:${post.id}`}
        onClose={() => setReporting(false)}
        onSubmit={(input) => actions.report(post, input)}
      />
    </article>
  );
}
