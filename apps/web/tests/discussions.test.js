import { describe, expect, it } from 'vitest';

import {
  addReply,
  addReplyToPages,
  addToPages,
  canReply,
  commentPath,
  mapPages,
  patchPages,
  patchThread,
  postActions,
  postPath,
  postState,
  removeFromPages,
  removeFromThread,
  threadPath,
  visibleReplies,
  voted,
  withoutReports,
} from '../src/lib/discussions.js';

const post = (id, extra = {}) => ({
  id,
  courseId: 'c1',
  lessonId: null,
  parentId: null,
  title: null,
  body: `Body ${id}`,
  author: { id: 'u1', name: 'Jonah', role: 'student', instructor: false },
  status: 'visible',
  pinned: false,
  locked: false,
  accepted: false,
  replyCount: 0,
  voteCount: 0,
  voted: false,
  createdAt: '2026-10-02T10:00:00.000Z',
  editedAt: null,
  lastActivityAt: '2026-10-02T10:00:00.000Z',
  mine: false,
  canModerate: false,
  reportCount: 0,
  reported: false,
  answered: false,
  ...extra,
});
const thread = (id, replies = [], extra = {}) => ({
  ...post(id, { title: `Thread ${id}`, replyCount: replies.length, ...extra }),
  replies,
  answered: false,
  lesson: null,
});
const reply = (id, parentId = 't1', extra = {}) => post(id, { parentId, ...extra });
const pages = (...lists) => ({
  pages: lists.map((items, i) => ({ items, nextCursor: i < lists.length - 1 ? `c${i}` : null })),
  pageParams: lists.map((_, i) => (i ? `c${i - 1}` : null)),
});

describe('what a viewer sees of a post', () => {
  it('shows hidden posts to their author and the moderators only, with a note', () => {
    expect(postState(post('a'))).toBe('visible');
    expect(postState(post('a', { status: 'hidden', body: '' }))).toBe('hidden');
    expect(postState(post('a', { status: 'hidden', mine: true }))).toBe('flagged');
    expect(postState(post('a', { status: 'hidden', canModerate: true }))).toBe('flagged');
    expect(postState(post('a', { status: 'deleted', body: '' }))).toBe('deleted');
  });

  it('offers each person only what they may do', () => {
    const mine = postActions(post('a', { mine: true }), { topLevel: true });
    expect(mine).toMatchObject({ edit: true, delete: true, report: false, pin: false, hide: false, accept: false });
    expect(mine.vote).toBe(false);
    const theirs = postActions(post('a'), { topLevel: false });
    expect(theirs).toMatchObject({ edit: false, delete: false, report: true, vote: true });
    expect(postActions(post('a', { status: 'hidden', canModerate: true }), { topLevel: true }).vote).toBe(false);
    const moderator = postActions(post('a', { canModerate: true }), { topLevel: true });
    expect(moderator).toMatchObject({ delete: true, report: true, pin: true, lock: true, hide: true, accept: false });
    expect(postActions(post('r', { canModerate: true, parentId: 't1' }), { topLevel: false })).toMatchObject({ pin: false, lock: false, accept: true });
    // Nothing more to do with a deleted placeholder; a hidden post can't be reported again.
    expect(Object.values(postActions(post('a', { status: 'deleted', mine: true, canModerate: true }), { topLevel: true })).some(Boolean)).toBe(false);
    expect(postActions(post('a', { status: 'hidden' }), { topLevel: true }).report).toBe(false);
    expect(postActions(post('a', { reported: true }), { topLevel: true }).report).toBe(false);
  });

  it('lets people reply unless the thread is locked (moderators still may), hidden or deleted', () => {
    expect(canReply(thread('t1'))).toBe(true);
    expect(canReply(thread('t1', [], { locked: true }))).toBe(false);
    expect(canReply(thread('t1', [], { locked: true, canModerate: true }))).toBe(true);
    expect(canReply(thread('t1', [], { status: 'deleted' }))).toBe(false);
    expect(canReply(thread('t1', [], { status: 'hidden', canModerate: true }))).toBe(false);
    expect(canReply(undefined)).toBe(false);
  });

  it('shows three replies, then "Show N more", unless one further down was linked to', () => {
    const replies = ['a', 'b', 'c', 'd', 'e'].map((id) => reply(id));
    expect(visibleReplies(replies)).toMatchObject({ more: 2 });
    expect(visibleReplies(replies).shown.map((r) => r.id)).toEqual(['a', 'b', 'c']);
    expect(visibleReplies(replies, { expanded: true }).shown).toHaveLength(5);
    expect(visibleReplies(replies, { keep: 'e' })).toMatchObject({ more: 0 });
    expect(visibleReplies(replies.slice(0, 3))).toMatchObject({ more: 0 });
    expect(visibleReplies(undefined)).toEqual({ shown: [], more: 0 });
  });
});

describe('cache updates', () => {
  it('change a thread or one of its replies', () => {
    const t = thread('t1', [reply('r1'), reply('r2')]);
    expect(patchThread(t, 't1', { pinned: true }).pinned).toBe(true);
    const patched = patchThread(t, 'r2', { body: 'Edited', editedAt: 'now' });
    expect(patched.replies[1]).toMatchObject({ body: 'Edited', editedAt: 'now' });
    expect(patched.replies[0]).toBe(t.replies[0]);
    expect(patchThread(t, 'elsewhere', { body: 'x' })).toBe(t);
    expect(patchThread(t, 'r1', (item) => voted(item, true)).replies[0]).toMatchObject({ voted: true, voteCount: 1 });
  });

  it('keep one accepted answer, and say the thread is answered', () => {
    let t = thread('t1', [reply('r1'), reply('r2')]);
    t = patchThread(t, 'r1', { accepted: true });
    expect(t.answered).toBe(true);
    t = patchThread(t, 'r2', { accepted: true });
    expect(t.replies.map((r) => r.accepted)).toEqual([false, true]);
    // Hiding the answer leaves the thread unanswered (only a reply in view counts).
    expect(patchThread(t, 'r2', { status: 'hidden' }).answered).toBe(false);
    t = patchThread(t, 'r2', { accepted: false });
    expect(t.answered).toBe(false);
  });

  it('add a reply once, and count it', () => {
    const t = thread('t1', [reply('r1')]);
    const added = addReply(t, reply('r2', 't1', { createdAt: '2026-10-02T11:00:00.000Z' }));
    expect(added.replies.map((r) => r.id)).toEqual(['r1', 'r2']);
    expect(added.replyCount).toBe(2);
    expect(added.lastActivityAt).toBe('2026-10-02T11:00:00.000Z');
    expect(addReply(added, reply('r2')).replies).toHaveLength(2);
    expect(addReply(t, reply('r9', 'other'))).toBe(t);
  });

  it('remove a deleted reply, and leave a deleted thread with replies as a placeholder', () => {
    const t = thread('t1', [reply('r1', 't1', { accepted: true }), reply('r2')], { answered: true });
    const without = removeFromThread(t, 'r1');
    expect(without.replies.map((r) => r.id)).toEqual(['r2']);
    expect(without).toMatchObject({ replyCount: 1, answered: false });
    expect(removeFromThread(t, 't1')).toMatchObject({ status: 'deleted', body: '', replies: t.replies });
    expect(removeFromThread(thread('t2'), 't2')).toBeNull();
  });

  it('apply across the pages of a list, dropping removed threads and leaving untouched pages as they were', () => {
    const data = pages([thread('t1', [reply('r1')]), thread('t2')], [thread('t3')]);
    const patched = patchPages(data, 'r1', { body: 'x' });
    expect(patched.pages[0].items[0].replies[0].body).toBe('x');
    expect(patched.pages[1]).toBe(data.pages[1]);
    expect(patchPages(data, 'nothing', { body: 'x' })).toBe(data);
    expect(removeFromPages(data, 't2').pages[0].items.map((t) => t.id)).toEqual(['t1']);
    expect(addReplyToPages(data, reply('r5', 't3')).pages[1].items[0].replies.map((r) => r.id)).toEqual(['r5']);
    expect(mapPages(undefined, (x) => x)).toBeUndefined();
  });

  it('put a new thread first, after the pinned ones, once', () => {
    const data = pages([thread('p', [], { pinned: true }), thread('t1')], [thread('t2')]);
    const added = addToPages(data, thread('new'));
    expect(added.pages[0].items.map((t) => t.id)).toEqual(['p', 'new', 't1']);
    expect(addToPages(added, thread('new'))).toBe(added);
    expect(addToPages(pages([thread('p', [], { pinned: true })]), thread('n')).pages[0].items.map((t) => t.id)).toEqual(['p', 'n']);
  });

  it('move a vote count at once', () => {
    expect(voted(post('a', { voteCount: 2 }), true)).toEqual({ voted: true, voteCount: 3 });
    expect(voted(post('a', { voteCount: 3, voted: true }), false)).toEqual({ voted: false, voteCount: 2 });
    expect(voted(post('a', { voteCount: 3, voted: true }), true)).toEqual({ voted: true, voteCount: 3 });
    expect(voted(post('a', { voteCount: 0 }), false)).toEqual({ voted: false, voteCount: 0 });
  });

  it('drop a resolved report, or every report about a hidden post', () => {
    const reports = [
      { id: 'x', post: { id: 'p1' } },
      { id: 'y', post: { id: 'p1' } },
      { id: 'z', post: { id: 'p2' } },
    ];
    expect(withoutReports(reports, { reportId: 'x' }).map((r) => r.id)).toEqual(['y', 'z']);
    expect(withoutReports(reports, { reportId: 'x', postId: 'p1' }).map((r) => r.id)).toEqual(['z']);
  });
});

describe('addresses', () => {
  it('lead to the thread, a reply in it, or the comment under its lesson', () => {
    expect(threadPath('riverside', 'piano', 't1')).toBe('/s/riverside/c/piano/discussions/t1');
    expect(threadPath('riverside', 'piano', 't1', 'r1')).toBe('/s/riverside/c/piano/discussions/t1?post=r1');
    expect(commentPath('riverside', 'piano', 'l1', 't1')).toBe('/s/riverside/c/piano/l/l1?comment=t1');
    expect(postPath('riverside', 'piano', { lessonId: 'l1', threadId: 't1', postId: 'r1' })).toBe('/s/riverside/c/piano/l/l1?comment=t1');
    expect(postPath('riverside', 'piano', { lessonId: null, threadId: 't1', postId: 't1' })).toBe('/s/riverside/c/piano/discussions/t1');
  });
});
