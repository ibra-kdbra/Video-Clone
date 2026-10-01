import { describe, expect, it } from 'vitest';
import { QueryClient } from '@tanstack/react-query';

import {
  RECENT_SIZE,
  addNotification,
  addToPage,
  addToPages,
  badgeCount,
  markPage,
  markPages,
  markRead,
  notificationKeys,
} from '../src/lib/notifications.js';

const note = (n, read = false) => ({
  id: `n${n}`,
  type: 'lesson.published',
  schoolId: 's1',
  data: { title: `Title ${n}`, body: '', path: '/s/x/c/y', schoolName: 'Riverside' },
  createdAt: `2026-10-01T10:0${n}:00.000Z`,
  readAt: read ? '2026-10-01T11:00:00.000Z' : null,
});

describe('notification pages', () => {
  it('puts a new one first and counts it as unread, once', () => {
    const page = { items: [note(1), note(2, true)], nextCursor: null, unread: 1 };
    const next = addToPage(page, note(3));
    expect(next.items.map((item) => item.id)).toEqual(['n3', 'n1', 'n2']);
    expect(next.unread).toBe(2);
    expect(addToPage(next, note(3))).toBe(next);
    expect(addToPage(page, note(4), { limit: 2 }).items.map((item) => item.id)).toEqual(['n4', 'n1']);
    expect(addToPage(undefined, note(1))).toBeUndefined();
  });

  it('marks some or all read, taking the unread count from the server', () => {
    const page = { items: [note(1), note(2), note(3, true)], nextCursor: 'c', unread: 2 };
    const some = markPage(page, ['n2'], 1, 'NOW');
    expect(some.items.map((item) => item.readAt)).toEqual([null, 'NOW', note(3, true).readAt]);
    expect(some.unread).toBe(1);
    const all = markPage(page, 'all', 0, 'NOW');
    expect(all.items.every((item) => item.readAt)).toBe(true);
    expect(all.unread).toBe(0);
  });

  it('does the same across the pages of the full list', () => {
    const data = { pages: [{ items: [note(1)], nextCursor: 'c', unread: 2 }, { items: [note(2)], nextCursor: null, unread: 2 }], pageParams: [null, 'c'] };
    const added = addToPages(data, note(3));
    expect(added.pages[0].items.map((item) => item.id)).toEqual(['n3', 'n1']);
    expect(added.pages.map((page) => page.unread)).toEqual([3, 3]);
    expect(addToPages(added, note(2))).toBe(added);
    const read = markPages(added, 'all', 0, 'NOW');
    expect(read.pages.flatMap((page) => page.items).every((item) => item.readAt === 'NOW')).toBe(true);
  });

  it('keeps every cached list in step with live events', () => {
    const client = new QueryClient();
    client.setQueryData(notificationKeys.recent, { items: Array.from({ length: RECENT_SIZE }, (_, i) => note(i)), nextCursor: 'c', unread: RECENT_SIZE });
    client.setQueryData(notificationKeys.list(false), { pages: [{ items: [note(1)], nextCursor: null, unread: 1 }], pageParams: [null] });

    addNotification(client, { ...note(9), id: 'fresh' });
    const recent = client.getQueryData(notificationKeys.recent);
    expect(recent.items).toHaveLength(RECENT_SIZE);
    expect(recent.items[0].id).toBe('fresh');
    expect(recent.unread).toBe(RECENT_SIZE + 1);
    expect(client.getQueryData(notificationKeys.list(false)).pages[0].items[0].id).toBe('fresh');
    // Lists that were never loaded stay unloaded.
    expect(client.getQueryData(notificationKeys.list(true))).toBeUndefined();

    markRead(client, ['fresh'], 4);
    expect(client.getQueryData(notificationKeys.recent).items[0].readAt).not.toBeNull();
    expect(client.getQueryData(notificationKeys.recent).unread).toBe(4);
    expect(client.getQueryData(notificationKeys.list(false)).pages[0].unread).toBe(4);
  });

  it('keeps the badge round', () => {
    expect(badgeCount(3)).toBe('3');
    expect(badgeCount(9)).toBe('9');
    expect(badgeCount(10)).toBe('9+');
  });
});
