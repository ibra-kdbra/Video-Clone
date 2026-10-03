import { coursePath, lessonPath } from './courses.js';
import { apiFetch } from './session.js';

/**
 * Discussions (Phase 3): a course's threads, comments under its lessons, and replies to either
 * (one level deep), with "helpful" votes, reports, and moderation by the course's editors. The API
 * calls (one function per endpoint, every path segment from data encoded), the cache keys, the
 * addresses, and pure helpers that fold a change into what's cached.
 */
const seg = encodeURIComponent;
const course = (slug, courseSlug) => `/schools/${seg(slug)}/courses/${seg(courseSlug)}`;
const base = (slug, courseSlug) => `${course(slug, courseSlug)}/discussions`;
const post = (slug, courseSlug, postId) => `${base(slug, courseSlug)}/${seg(postId)}`;

export const THREADS_PAGE = 20;
export const COMMENTS_PAGE = 10;
/** Under a lesson comment, this many replies show before "Show N more". */
export const REPLIES_SHOWN = 3;

function withParams(path, params) {
  const search = new URLSearchParams();
  for (const [name, value] of Object.entries(params)) if (value !== undefined && value !== null && value !== '') search.set(name, String(value));
  const query = search.toString();
  return query ? `${path}?${query}` : path;
}

export const getThreads = (slug, courseSlug, { sort, filter, cursor, limit = THREADS_PAGE } = {}, signal) =>
  apiFetch(withParams(base(slug, courseSlug), { sort, filter, cursor, limit }), { signal });
export const createThread = (slug, courseSlug, input) => apiFetch(base(slug, courseSlug), { method: 'POST', body: input });
export const getThread = (slug, courseSlug, postId, signal) => apiFetch(post(slug, courseSlug, postId), { signal });
export const replyTo = (slug, courseSlug, postId, input) => apiFetch(`${post(slug, courseSlug, postId)}/replies`, { method: 'POST', body: input });
export const editPost = (slug, courseSlug, postId, input) => apiFetch(post(slug, courseSlug, postId), { method: 'PATCH', body: input });
export const deletePost = (slug, courseSlug, postId) => apiFetch(post(slug, courseSlug, postId), { method: 'DELETE' });
/** Found it helpful (or not any more): `{ voteCount, voted }`. */
export const votePost = (slug, courseSlug, postId, on) => apiFetch(`${post(slug, courseSlug, postId)}/vote`, { method: on ? 'PUT' : 'DELETE' });
export const moderatePost = (slug, courseSlug, postId, input) => apiFetch(`${post(slug, courseSlug, postId)}/moderate`, { method: 'POST', body: input });
export const reportPost = (slug, courseSlug, postId, input) => apiFetch(`${post(slug, courseSlug, postId)}/report`, { method: 'POST', body: input });
export const getReports = (slug, courseSlug, signal) => apiFetch(`${base(slug, courseSlug)}/reports`, { signal });
export const resolveReport = (slug, courseSlug, reportId, action) =>
  apiFetch(`${base(slug, courseSlug)}/reports/${seg(reportId)}/resolve`, { method: 'POST', body: { action } });

const comments = (slug, courseSlug, lessonId) => `${course(slug, courseSlug)}/lessons/${seg(lessonId)}/comments`;
export const getLessonComments = (slug, courseSlug, lessonId, { sort, cursor, limit = COMMENTS_PAGE } = {}, signal) =>
  apiFetch(withParams(comments(slug, courseSlug, lessonId), { sort, cursor, limit }), { signal });
export const createLessonComment = (slug, courseSlug, lessonId, input) => apiFetch(comments(slug, courseSlug, lessonId), { method: 'POST', body: input });

/** Cache keys, all under 'discussions', so one call refreshes everything about a course's discussions. */
export const discussionKeys = {
  all: ['discussions'],
  course: (slug, courseSlug) => ['discussions', slug, courseSlug],
  lists: (slug, courseSlug) => ['discussions', slug, courseSlug, 'list'],
  list: (slug, courseSlug, sort, filter) => ['discussions', slug, courseSlug, 'list', sort, filter],
  thread: (slug, courseSlug, postId) => ['discussions', slug, courseSlug, 'thread', postId],
  lessonComments: (slug, courseSlug, lessonId) => ['discussions', slug, courseSlug, 'comments', lessonId],
  comments: (slug, courseSlug, lessonId, sort) => ['discussions', slug, courseSlug, 'comments', lessonId, sort],
  reports: (slug, courseSlug) => ['discussions', slug, courseSlug, 'reports'],
};

/** Addresses in the app. */
export const discussionsPath = (slug, courseSlug) => `${coursePath(slug, courseSlug)}/discussions`;
export const threadPath = (slug, courseSlug, threadId, postId) =>
  `${discussionsPath(slug, courseSlug)}/${threadId}${postId && postId !== threadId ? `?post=${seg(postId)}` : ''}`;
export const reportsPath = (slug, courseSlug) => `${discussionsPath(slug, courseSlug)}/reports`;
export const commentPath = (slug, courseSlug, lessonId, threadId) => `${lessonPath(slug, courseSlug, lessonId)}?comment=${seg(threadId)}`;

/** Where a post (a thread, a lesson comment or a reply) is seen, given its thread's id. */
export const postPath = (slug, courseSlug, { lessonId, threadId, postId }) =>
  lessonId ? commentPath(slug, courseSlug, lessonId, threadId) : threadPath(slug, courseSlug, threadId, postId);

export const SORT_OPTIONS = [
  { value: 'activity', label: 'Recent activity' },
  { value: 'new', label: 'Newest' },
  { value: 'top', label: 'Most helpful' },
];

export const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'unanswered', label: 'Unanswered' },
  { key: 'mine', label: 'Mine' },
];

export const REPORT_REASON_LABELS = {
  spam: 'Spam or advertising',
  abuse: 'Harassment or abuse',
  off_topic: 'Off topic',
  other: 'Something else',
};

// What a viewer sees of a post ----------------------------------------------------------------------

/**
 * - 'deleted': a placeholder (deleted, with replies under it)
 * - 'hidden': a placeholder (hidden by a moderator, from everyone but its author and the moderators)
 * - 'flagged': shown, with a note that it's hidden from everyone else
 * - 'visible'
 */
export function postState(item) {
  if (item.status === 'deleted') return 'deleted';
  if (item.status === 'hidden') return item.mine || item.canModerate ? 'flagged' : 'hidden';
  return 'visible';
}

/** A thread can take replies: it's in view (not hidden or deleted), and not locked (moderators may still). */
export const canReply = (thread) => Boolean(thread) && (!thread.locked || thread.canModerate) && thread.status === 'visible';

/**
 * The actions this viewer has on a post, as the API allows them. `topLevel`: a thread or a lesson
 * comment (pinned and locked apply); otherwise a reply (accepted applies).
 */
export function postActions(item, { topLevel }) {
  const gone = item.status === 'deleted';
  const moderate = item.canModerate && !gone;
  return {
    edit: item.mine && !gone,
    delete: (item.mine || item.canModerate) && !gone,
    // Once per person and post.
    report: !item.mine && item.status === 'visible' && !item.reported,
    vote: !item.mine && item.status === 'visible',
    pin: moderate && topLevel,
    lock: moderate && topLevel,
    hide: moderate,
    accept: moderate && !topLevel && item.status === 'visible',
  };
}

/** Which replies show: the first `limit` (all when expanded, or when `keep` is further down), and how many wait. */
export function visibleReplies(replies, { expanded = false, limit = REPLIES_SHOWN, keep = null } = {}) {
  const list = replies ?? [];
  const keepAt = keep ? list.findIndex((reply) => reply.id === keep) : -1;
  if (expanded || list.length <= limit || keepAt >= limit) return { shown: list, more: 0 };
  return { shown: list.slice(0, limit), more: list.length - limit };
}

// Cache updates (pure) ---------------------------------------------------------------------------

/** As the API has it: a reply in view has been accepted as the answer. */
const isAnswered = (replies) => replies.some((reply) => reply.accepted && reply.status === 'visible');

const merge = (item, patch) => ({ ...item, ...(typeof patch === 'function' ? patch(item) : patch) });

/**
 * A thread (or lesson comment) with one of its posts changed: itself, or a reply. Accepting a reply
 * as the answer takes it from any other reply, and `answered` follows.
 */
export function patchThread(thread, postId, patch) {
  if (!thread) return thread;
  if (thread.id === postId) return merge(thread, patch);
  if (!thread.replies?.some((reply) => reply.id === postId)) return thread;
  let replies = thread.replies.map((reply) => (reply.id === postId ? merge(reply, patch) : reply));
  const accepted = replies.find((reply) => reply.id === postId)?.accepted;
  if (accepted) replies = replies.map((reply) => (reply.id === postId || !reply.accepted ? reply : { ...reply, accepted: false }));
  return { ...thread, replies, answered: isAnswered(replies) };
}

/** A thread with a new reply at the end (unless it's there already). */
export function addReply(thread, reply) {
  if (!thread || thread.id !== reply.parentId) return thread;
  if (thread.replies?.some((item) => item.id === reply.id)) return patchThread(thread, reply.id, reply);
  return {
    ...thread,
    replies: [...(thread.replies ?? []), reply],
    replyCount: thread.replyCount + 1,
    lastActivityAt: reply.createdAt ?? thread.lastActivityAt,
  };
}

/**
 * A thread once one of its posts is deleted. A reply goes. The thread itself stays as a
 * placeholder while it has replies; without any it's gone (null).
 */
export function removeFromThread(thread, postId) {
  if (!thread) return thread;
  if (thread.id === postId) {
    if (!thread.replies?.length) return null;
    return { ...thread, status: 'deleted', body: '' };
  }
  if (!thread.replies?.some((reply) => reply.id === postId)) return thread;
  const replies = thread.replies.filter((reply) => reply.id !== postId);
  return { ...thread, replies, replyCount: Math.max(0, thread.replyCount - 1), answered: isAnswered(replies) };
}

/** The same change across a paged list (useInfiniteQuery's `{ pages, pageParams }`); null items drop out. */
export function mapPages(data, change) {
  if (!data?.pages) return data;
  let changed = false;
  const pages = data.pages.map((page) => {
    const items = page.items.map(change);
    if (items.every((item, index) => item === page.items[index])) return page;
    changed = true;
    return { ...page, items: items.filter(Boolean) };
  });
  return changed ? { ...data, pages } : data;
}

export const patchPages = (data, postId, patch) => mapPages(data, (item) => patchThread(item, postId, patch));
export const removeFromPages = (data, postId) => mapPages(data, (item) => removeFromThread(item, postId));
export const addReplyToPages = (data, reply) => mapPages(data, (item) => addReply(item, reply));

/** A new thread or lesson comment, first on the first page (unless it's there already). */
export function addToPages(data, item) {
  if (!data?.pages?.length) return data;
  if (data.pages.some((page) => page.items.some((existing) => existing.id === item.id))) return data;
  const [first, ...rest] = data.pages;
  // Pinned ones stay first; the new one goes right after them.
  const at = first.items.findIndex((existing) => !existing.pinned);
  const items = at === -1 ? [...first.items, item] : [...first.items.slice(0, at), item, ...first.items.slice(at)];
  return { ...data, pages: [{ ...first, items }, ...rest] };
}

/** A report list without the reports about this post (they're dealt with once it's hidden). */
export const withoutReports = (reports, { reportId, postId }) =>
  reports?.filter((report) => report.id !== reportId && (!postId || report.post.id !== postId)) ?? reports;

/** Posts with a pending vote change, before the server answers: the count moves at once. */
export const voted = (item, on) => ({ voted: on, voteCount: Math.max(0, item.voteCount + (on === item.voted ? 0 : on ? 1 : -1)) });
