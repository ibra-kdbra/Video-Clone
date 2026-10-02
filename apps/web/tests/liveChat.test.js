import { describe, expect, it } from 'vitest';

import {
  CHAT_LIMIT,
  addPending,
  atBottom,
  canSend,
  chatRemaining,
  confirmPending,
  failPending,
  hideMessage,
  isLocal,
  mergeMessages,
  oldestId,
  receiveMessage,
  retryPending,
  trimMessages,
  unseenCount,
} from '../src/lib/liveChat.js';

const me = { id: 'me', name: 'Amira', host: false };
const other = { id: 'u2', name: 'Jonah', host: false };
const msg = (id, second, author = other, body = `Message ${id}`) => ({
  id,
  sessionId: 's1',
  author,
  body,
  hidden: false,
  createdAt: `2026-10-02T12:00:${String(second).padStart(2, '0')}.000Z`,
});

describe('the class chat', () => {
  it('merges history and pushes into one ordered list, one copy each', () => {
    const list = mergeMessages([], [msg('b', 2), msg('a', 1)]);
    expect(list.map((m) => m.id)).toEqual(['a', 'b']);
    const again = mergeMessages(list, [msg('c', 3), msg('a', 1)]);
    expect(again.map((m) => m.id)).toEqual(['a', 'b', 'c']);
    expect(mergeMessages(list, [])).toBe(list);
    // Older ones, loaded by scrolling back, go before.
    expect(mergeMessages(again, [msg('z', 0)]).map((m) => m.id)).toEqual(['z', 'a', 'b', 'c']);
  });

  it('shows my message at once, then swaps it for the stored one when acknowledged', () => {
    let list = mergeMessages([], [msg('a', 1)]);
    list = addPending(list, { id: 'local-1', body: 'Hello!', author: me, now: '2026-10-02T12:00:05.000Z' });
    expect(list.at(-1)).toMatchObject({ id: 'local-1', pending: true, body: 'Hello!' });
    // Someone else's message arrives while mine is pending: mine stays last.
    list = receiveMessage(list, msg('b', 6), 'me');
    expect(list.map((m) => m.id)).toEqual(['a', 'b', 'local-1']);
    list = confirmPending(list, 'local-1', msg('mine', 5, me, 'Hello!'));
    expect(list.map((m) => m.id)).toEqual(['a', 'mine', 'b']);
    expect(list.some(isLocal)).toBe(false);
  });

  it('takes the pushed copy of my own message in place of the pending one, if it comes before the acknowledgement', () => {
    let list = addPending([], { id: 'local-1', body: 'Same text', author: me });
    list = addPending(list, { id: 'local-2', body: 'Same text', author: me });
    list = receiveMessage(list, msg('m1', 1, me, 'Same text'), 'me');
    expect(list.map((m) => m.id)).toEqual(['m1', 'local-2']);
    // The acknowledgement for the first then finds it there already.
    list = confirmPending(list, 'local-1', msg('m1', 1, me, 'Same text'));
    expect(list.map((m) => m.id)).toEqual(['m1', 'local-2']);
    list = confirmPending(list, 'local-2', msg('m2', 2, me, 'Same text'));
    expect(list.map((m) => m.id)).toEqual(['m1', 'm2']);
    // Someone else's message with the same text doesn't take its place.
    list = addPending(list, { id: 'local-3', body: 'Hi', author: me });
    list = receiveMessage(list, msg('x', 3, other, 'Hi'), 'me');
    expect(list.map((m) => m.id)).toEqual(['m1', 'm2', 'x', 'local-3']);
  });

  it('keeps a failed message, marked, until it’s sent again', () => {
    let list = addPending([], { id: 'local-1', body: 'Hello', author: me });
    list = failPending(list, 'local-1', 'Too many messages');
    expect(list[0]).toMatchObject({ pending: false, failed: true, error: 'Too many messages' });
    // A failed message isn't matched by a push.
    expect(receiveMessage(list, msg('m', 1, me, 'Hello'), 'me').map((m) => m.id)).toEqual(['m', 'local-1']);
    list = retryPending(list, 'local-1');
    expect(list[0]).toMatchObject({ pending: true, failed: false });
    expect(confirmPending(list, 'local-1', null)).toEqual([]);
  });

  it('hides a message: its text goes, except for hosts', () => {
    const list = mergeMessages([], [msg('a', 1), msg('b', 2)]);
    expect(hideMessage(list, 'a')[0]).toMatchObject({ hidden: true, body: '' });
    expect(hideMessage(list, 'a', { keepBody: true })[0]).toMatchObject({ hidden: true, body: 'Message a' });
    expect(hideMessage(list, 'a')[1]).toBe(list[1]);
  });

  it('keeps the latest messages, and knows where to load earlier ones from', () => {
    const list = addPending(mergeMessages([], [msg('a', 1), msg('b', 2), msg('c', 3)]), { id: 'local-1', body: 'x', author: me });
    expect(trimMessages(list, 2).map((m) => m.id)).toEqual(['b', 'c', 'local-1']);
    expect(trimMessages(list, 5)).toBe(list);
    expect(oldestId(list)).toBe('a');
    expect(oldestId([])).toBeNull();
  });

  it('counts down to the 500-character limit', () => {
    expect(chatRemaining('')).toBe(CHAT_LIMIT);
    expect(chatRemaining('  hi  ')).toBe(498);
    expect(canSend('   ')).toBe(false);
    expect(canSend('hi')).toBe(true);
    expect(canSend('x'.repeat(500))).toBe(true);
    expect(canSend('x'.repeat(501))).toBe(false);
  });

  it('knows when the list is at the bottom, and how many came in since', () => {
    expect(atBottom({ scrollTop: 552, scrollHeight: 1000, clientHeight: 400 })).toBe(true);
    expect(atBottom({ scrollTop: 300, scrollHeight: 1000, clientHeight: 400 })).toBe(false);
    const list = mergeMessages([], [msg('a', 1), msg('b', 2), msg('c', 3, me), msg('d', 4)]);
    expect(unseenCount(list, 'a', 'me')).toBe(2);
    expect(unseenCount(list, 'd', 'me')).toBe(0);
    expect(unseenCount(list, null, 'me')).toBe(3);
  });
});
