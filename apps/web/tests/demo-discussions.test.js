import { describe, expect, it } from 'vitest';

import { createServer } from '../src/demo/core.js';
import { MEDIA } from '../src/demo/media.js';
import { excerpt, plainText } from '../src/demo/notices.js';
import { validateSocial } from '../src/demo/validate.js';
import { CONTENT, SOCIAL, START, course, lessonId, memoryStorage, setup, thread, userId } from './demo-setup.js';

/**
 * Phase 3 in the demo's mock API: course discussions, lesson comments, votes, moderation and
 * reports (apps/api/src/discussions), the notifications they send (apps/worker), and the seeded
 * conversations (src/demo/social.js).
 */

const LA = 'linear-algebra-visually';
const SOUND = 'physics-of-sound';
const discussions = (slug) => `${course(slug)}/discussions`;
const post = (slug, id) => `${discussions(slug)}/${id}`;

describe('the social content', () => {
  it('follows the API’s rules, and seeds without problems', () => {
    expect(validateSocial(SOCIAL, CONTENT)).toEqual([]);
    // strict: any problem building the seed would throw here.
    expect(() => setup()).not.toThrow();
  });

  it('catches mistakes, loudly', () => {
    const [first, ...rest] = SOCIAL.THREADS[LA];
    const broken = {
      ...SOCIAL,
      THREADS: {
        ...SOCIAL.THREADS,
        [LA]: [
          {
            ...first,
            title: 'Hi',
            replies: [
              { key: 'a', author: 'kwame', daysAgo: first.daysAgo + 1, body: 'Before the thread' },
              { key: 'b', author: 'kwame', daysAgo: 1, body: 'One', accepted: true },
              { key: 'c', author: 'nobody', daysAgo: 1, body: 'Two', accepted: true, pinned: true },
            ],
          },
          ...rest,
        ],
      },
      COMMENTS: { ...SOCIAL.COMMENTS, [LA]: [{ key: 'x', lesson: 'nope', author: 'amira', daysAgo: 1, body: '' }] },
      REPORTS: [{ course: LA, thread: 'order', reporter: 'amira', reason: 'rude', daysAgo: 1 }],
      LIVE: [
        { ...SOCIAL.LIVE[0], provider: 'livekit', recordingRef: 'not-a-video-id' },
        { ...SOCIAL.LIVE[1], streamRef: 'dQw4w9WgXcQ' },
      ],
      LIVE_CHAT: { ...SOCIAL.LIVE_CHAT, courses: { ...SOCIAL.LIVE_CHAT.courses, [LA]: { lines: ['Hello'], hands: [] } } },
    };
    const problems = validateSocial(broken, CONTENT).join('\n');
    expect(problems).toMatch(/title: Use at least 3 characters/);
    expect(problems).toMatch(/must come after the post it replies to/);
    expect(problems).toMatch(/only one reply can be the answer/);
    expect(problems).toMatch(/unknown person "nobody"/);
    expect(problems).toMatch(/only threads and lesson comments can be pinned or locked/);
    expect(problems).toMatch(/unknown lesson "nope"/);
    expect(problems).toMatch(/body: Write something first/);
    expect(problems).toMatch(/people can't report their own post/);
    expect(problems).toMatch(/unknown reason "rude"/);
    expect(problems).toMatch(/not "livekit"/);
    expect(problems).toMatch(/recordingRef/);
    expect(problems).toMatch(/dQw4w9WgXcQ isn't one of linear-algebra-visually's lesson videos/);
    expect(problems).toMatch(/lines: needs at least 20 lines/);
    expect(() => createServer({ content: CONTENT, media: MEDIA, social: broken, storage: memoryStorage(), latency: 0, strict: true })).toThrow(/problems/);

    // What only the seed can tell: a persona writing in a course they don't take.
    const outsider = { ...SOCIAL, THREADS: { ...SOCIAL.THREADS, 'neural-networks': [{ key: 'q', author: 'amira', daysAgo: 1, title: 'Not my course', body: 'Hello' }] } };
    expect(validateSocial(outsider, CONTENT)).toEqual([]);
    expect(() => createServer({ content: CONTENT, media: MEDIA, social: outsider, storage: memoryStorage(), latency: 0, strict: true })).toThrow(
      /amira isn't enrolled in neural-networks/,
    );
  });

  it('seeds most published courses with conversations, and Daniel’s with the most', () => {
    const { server } = setup();
    const published = CONTENT.COURSES.filter((spec) => spec.status === 'published');
    const withThreads = published.filter((spec) => server.db.count('posts', (row) => row.courseId === server.db.find('courses', (c) => c.slug === spec.slug).id) > 0);
    expect(withThreads.length).toBe(published.length);
    const count = (slug) => server.db.count('posts', (row) => row.courseId === server.db.find('courses', (c) => c.slug === slug).id);
    const daniels = published.filter((spec) => spec.author === 'daniel').reduce((sum, spec) => sum + count(spec.slug), 0);
    expect(daniels).toBeGreaterThan(published.filter((spec) => spec.author !== 'daniel').reduce((sum, spec) => sum + count(spec.slug), 0) / 2);
  });
});

describe('course threads', () => {
  it('lists threads pinned first, with what each viewer may see', async () => {
    const { call, signIn } = setup();
    const amira = await signIn('amira');
    const list = (await call('GET', discussions(LA), { token: amira })).body;
    expect(list.items[0]).toMatchObject({
      id: thread(LA, 'welcome'),
      pinned: true,
      title: 'Welcome! Introduce yourself here',
      author: { name: 'Daniel Okafor', instructor: true, role: 'instructor' },
    });
    // Latest activity first after that.
    const rest = list.items.slice(1).map((item) => Date.parse(item.lastActivityAt));
    expect(rest).toEqual([...rest].sort((a, b) => b - a));
    // A deleted thread with replies stays, as a placeholder.
    const placeholder = list.items.find((item) => item.id === thread(LA, 'project-3d'));
    expect(placeholder).toMatchObject({ status: 'deleted', title: null, body: '', author: null, mine: false, replyCount: 2 });
    // Amira's own, and her vote.
    const mine = list.items.find((item) => item.id === thread(LA, 'order'));
    expect(mine).toMatchObject({ mine: true, canModerate: false, reportCount: 0, voted: false, voteCount: 6 });
    expect(list.items.find((item) => item.id === thread(LA, 'quiz-answers'))).toMatchObject({ locked: true });

    const welcome = (await call('GET', post(LA, thread(LA, 'welcome')), { token: amira })).body;
    const spam = welcome.replies.find((reply) => reply.id === thread(LA, 'welcome', 'hugo'));
    expect(spam).toMatchObject({ status: 'hidden', body: '' });
    expect(welcome.replyCount).toBe(welcome.replies.length - 1);
    const daniel = await signIn('daniel');
    const forDaniel = (await call('GET', post(LA, thread(LA, 'welcome')), { token: daniel })).body;
    expect(forDaniel.replies.find((reply) => reply.id === spam.id).body).toMatch(/assignments/);
    expect(forDaniel).toMatchObject({ canModerate: true });

    // The thread, by its id or a reply's; answered when a reply is accepted.
    const order = (await call('GET', post(LA, thread(LA, 'order', 'kwame')), { token: amira })).body;
    expect(order).toMatchObject({ id: thread(LA, 'order'), answered: true, lesson: null });
    expect(order.replies.filter((reply) => reply.accepted).map((reply) => reply.id)).toEqual([thread(LA, 'order', 'daniel')]);
    expect(order.replies.find((reply) => reply.id === thread(LA, 'order', 'daniel'))).toMatchObject({ voted: true });
  });

  it('is for the course’s editors and enrolled students only', async () => {
    const { call, signIn } = setup();
    const amira = await signIn('amira');
    // Not enrolled in Neural Networks.
    const outside = await call('GET', discussions('neural-networks'), { token: amira });
    expect(outside).toMatchObject({ status: 403, body: { error: { code: 'enrollment_required', message: 'Enroll in this course to take part in its discussions.' } } });
    expect((await call('GET', post('neural-networks', thread('neural-networks', 'squashing')), { token: amira })).status).toBe(403);
    expect((await call('POST', discussions('neural-networks'), { token: amira, body: { title: 'Let me in', body: 'Please' } })).status).toBe(403);
    // Another course's instructor isn't one of its editors; the owner is.
    const daniel = await signIn('daniel');
    expect((await call('GET', discussions('neural-networks'), { token: daniel })).status).toBe(403);
    const lena = await signIn('lena');
    expect((await call('GET', discussions('neural-networks'), { token: lena })).body.items[0]).toMatchObject({ canModerate: true });
    // A draft course is "not found" to students.
    expect((await call('GET', discussions('python-for-beginners'), { token: amira })).status).toBe(404);
    // Checked like every input.
    const invalid = await call('POST', discussions(LA), { token: amira, body: { title: 'Hi', body: '' } });
    expect(invalid.body.error).toMatchObject({ code: 'validation_failed', message: 'Some fields need attention.' });
    expect(invalid.body.error.details.map((detail) => detail.path).sort()).toEqual(['body', 'title']);
  });

  it('starts threads and replies, tells the right people, and the people watching', async () => {
    const { call, signIn, server, socket, sent } = setup();
    const amira = await signIn('amira');
    const daniel = await signIn('daniel');
    const courseId = server.db.find('courses', (row) => row.slug === LA).id;

    // Watching the course: its readers only.
    expect(socket('amira').watch(courseId)).toEqual({ ok: true, data: undefined });
    expect(socket('amira').watch('nope')).toMatchObject({ ok: false, error: { code: 'validation_failed' } });
    expect(socket('amira').watch(server.db.find('courses', (row) => row.slug === 'neural-networks').id)).toMatchObject({ ok: false, error: { code: 'enrollment_required' } });
    expect(socket('amira').watch(userId('amira'))).toMatchObject({ ok: false, error: { code: 'not_found' } });

    const before = server.db.count('notifications', (row) => row.userId === userId('daniel'));
    const created = await call('POST', discussions(LA), {
      token: amira,
      body: { title: 'How do I picture a shear?', body: 'The square leans over, but why does its area stay the same?' },
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      title: 'How do I picture a shear?',
      mine: true,
      replies: [],
      answered: false,
      lesson: null,
      status: 'visible',
      author: { name: 'Amira Haddad', instructor: false },
    });
    expect(sent({ event: 'discussion:changed', course: courseId }).at(-1).payload).toEqual({
      courseId,
      lessonId: null,
      threadId: created.body.id,
      postId: created.body.id,
      change: 'created',
    });
    // The course's instructor hears about it.
    const posted = server.db.filter('notifications', (row) => row.userId === userId('daniel')).sort((a, b) => b.createdAt - a.createdAt)[0];
    expect(server.db.count('notifications', (row) => row.userId === userId('daniel'))).toBe(before + 1);
    expect(posted).toMatchObject({
      type: 'discussion.posted',
      data: { title: 'Amira Haddad started a thread: How do I picture a shear?', path: `/s/grand-academy/c/${LA}/discussions/${created.body.id}` },
    });

    // Daniel replies: Amira hears about it; the list's activity moves.
    const reply = await call('POST', `${post(LA, created.body.id)}/replies`, { token: daniel, body: { body: 'It keeps its base and its height.' } });
    expect(reply.status).toBe(201);
    expect(reply.body).toMatchObject({ parentId: created.body.id, title: null, author: { instructor: true } });
    const told = server.db.filter('notifications', (row) => row.userId === userId('amira') && row.type === 'discussion.reply').sort((a, b) => b.createdAt - a.createdAt)[0];
    expect(told.data).toMatchObject({ title: 'Daniel Okafor replied in “How do I picture a shear?”', body: 'It keeps its base and its height.' });
    expect((await call('GET', discussions(LA), { token: amira })).body.items[1]).toMatchObject({ id: created.body.id, replyCount: 1 });
    // Only the thread's author hears of replies: Lena replying tells Amira, not Daniel, who replied before.
    const lena = await signIn('lena');
    const replies = (key) => server.db.count('notifications', (row) => row.userId === userId(key) && row.type === 'discussion.reply');
    const [amiraBefore, danielBefore] = [replies('amira'), replies('daniel')];
    await call('POST', `${post(LA, created.body.id)}/replies`, { token: lena, body: { body: 'A shear is a slide, not a stretch.' } });
    expect([replies('amira'), replies('daniel')]).toEqual([amiraBefore + 1, danielBefore]);

    // Replies are one level deep, and not to deleted or locked threads (except for moderators).
    expect((await call('POST', `${post(LA, reply.body.id)}/replies`, { token: amira, body: { body: 'Nested?' } })).body.error).toMatchObject({
      code: 'conflict',
      message: 'Reply to the thread, not to a reply.',
    });
    expect((await call('POST', `${post(LA, thread(LA, 'project-3d'))}/replies`, { token: amira, body: { body: 'Hello?' } })).body.error.message).toBe(
      "This post can't take replies.",
    );
    const locked = await call('POST', `${post(LA, thread(LA, 'quiz-answers'))}/replies`, { token: amira, body: { body: 'Please unlock' } });
    expect(locked).toMatchObject({ status: 409, body: { error: { message: 'This thread is locked: no new replies.' } } });
    expect((await call('POST', `${post(LA, thread(LA, 'quiz-answers'))}/replies`, { token: daniel, body: { body: 'Moderators can still reply.' } })).status).toBe(201);
  });

  it('respects people’s notification settings', async () => {
    const { call, signIn, server } = setup();
    const amira = await signIn('amira');
    const daniel = await signIn('daniel');
    await call('PUT', '/notifications/settings', { token: amira, body: { settings: { 'discussion.reply': { inApp: false, email: false } } } });
    const before = server.db.count('notifications', (row) => row.userId === userId('amira'));
    await call('POST', `${post(LA, thread(LA, 'order'))}/replies`, { token: daniel, body: { body: 'One more thought.' } });
    expect(server.db.count('notifications', (row) => row.userId === userId('amira'))).toBe(before);
  });

  it('pages through threads, and filters them', async () => {
    const { call, signIn } = setup();
    const amira = await signIn('amira');
    const all = (await call('GET', `${discussions(LA)}?sort=new&limit=50`, { token: amira })).body.items.map((item) => item.id);
    const pages = [];
    let cursor = null;
    do {
      const page = (await call('GET', `${discussions(LA)}?sort=new&limit=3${cursor ? `&cursor=${cursor}` : ''}`, { token: amira })).body;
      pages.push(...page.items.map((item) => item.id));
      cursor = page.nextCursor;
    } while (cursor);
    expect(pages).toEqual(all);
    expect(all[0]).toBe(thread(LA, 'welcome'));
    expect((await call('GET', `${discussions(LA)}?cursor=nonsense`, { token: amira })).body.error).toMatchObject({
      code: 'bad_request',
      message: 'This page link is no longer valid.',
    });
    expect((await call('GET', `${discussions(LA)}?sort=hot`, { token: amira })).status).toBe(400);

    // Top: pinned, then the most helpful.
    const top = (await call('GET', `${discussions(LA)}?sort=top&limit=50`, { token: amira })).body.items;
    expect(top[0].pinned).toBe(true);
    const votes = top.slice(1).map((item) => item.voteCount);
    expect(votes).toEqual([...votes].sort((a, b) => b - a));

    // Mine: started or replied to. Unanswered: no accepted reply.
    const mine = (await call('GET', `${discussions(LA)}?filter=mine&limit=50`, { token: amira })).body.items.map((item) => item.id);
    expect(new Set(mine)).toEqual(new Set([thread(LA, 'welcome'), thread(LA, 'order'), thread(LA, 'study-group')]));
    const unanswered = (await call('GET', `${discussions(LA)}?filter=unanswered&limit=50`, { token: amira })).body.items.map((item) => item.id);
    expect(unanswered).toContain(thread(LA, 'determinant-3d'));
    expect(unanswered).not.toContain(thread(LA, 'order'));
  });
});

describe('editing, deleting and voting', () => {
  it('lets authors edit their own posts, and nobody else', async () => {
    const { call, signIn } = setup();
    const amira = await signIn('amira');
    const daniel = await signIn('daniel');
    const url = post(LA, thread(LA, 'order'));
    const edited = await call('PATCH', url, { token: amira, body: { title: 'BA means “A first, then B”', body: 'Reading right to left now.' } });
    expect(edited).toMatchObject({ status: 200, body: { title: 'BA means “A first, then B”', body: 'Reading right to left now.', editedAt: expect.any(String) } });
    expect((await call('PATCH', url, { token: daniel, body: { body: 'Even moderators' } })).body.error).toMatchObject({
      code: 'forbidden',
      message: 'Only its author can edit a post.',
    });
    const titled = await call('PATCH', post(LA, thread(LA, 'order', 'amira')), { token: amira, body: { title: 'Replies have none', body: 'x' } });
    expect(titled.body.error).toMatchObject({ code: 'validation_failed', message: 'Only threads have titles.', details: [{ path: 'title', message: 'Only threads have titles' }] });
  });

  it('leaves a placeholder for a post with replies, and removes one without', async () => {
    const { call, signIn, server } = setup();
    const amira = await signIn('amira');
    const created = (await call('POST', discussions(LA), { token: amira, body: { title: 'A thread to delete', body: 'Soon gone' } })).body;
    const daniel = await signIn('daniel');
    const reply = (await call('POST', `${post(LA, created.id)}/replies`, { token: daniel, body: { body: 'A reply' } })).body;

    expect((await call('DELETE', post(LA, created.id), { token: amira })).status).toBe(204);
    const placeholder = (await call('GET', post(LA, created.id), { token: amira })).body;
    expect(placeholder).toMatchObject({ status: 'deleted', title: null, body: '', author: null, mine: false });
    expect(placeholder.replies.map((item) => item.id)).toEqual([reply.id]);
    expect(server.db.get('posts', created.id)).toMatchObject({ title: '[deleted]', body: '[deleted]' });
    // Deleting again is nothing; voting on or reporting a placeholder isn't possible.
    expect((await call('DELETE', post(LA, created.id), { token: amira })).status).toBe(204);
    expect((await call('PUT', `${post(LA, created.id)}/vote`, { token: daniel })).status).toBe(409);

    // Its last reply gone, the deleted thread goes too.
    expect((await call('DELETE', post(LA, reply.id), { token: daniel })).status).toBe(204);
    expect((await call('GET', post(LA, created.id), { token: amira })).status).toBe(404);
    expect(server.db.get('posts', created.id)).toBeNull();

    // Moderators delete anyone's; other students can't.
    const other = thread(LA, 'study-group', 'zara');
    expect((await call('DELETE', post(LA, other), { token: amira })).body.error.message).toBe('Only its author or a moderator can delete a post.');
    expect((await call('DELETE', post(LA, other), { token: daniel })).status).toBe(204);
    expect(server.db.get('posts', other)).toBeNull();
    expect(server.db.count('votes', (row) => row.postId === other)).toBe(0);
    expect(server.db.get('posts', thread(LA, 'study-group')).replyCount).toBe(2);
  });

  it('counts helpful votes, one per person, never your own', async () => {
    const { call, signIn } = setup();
    const amira = await signIn('amira');
    const daniel = await signIn('daniel');
    const url = `${post(LA, thread(LA, 'rotation'))}/vote`;
    const before = (await call('GET', post(LA, thread(LA, 'rotation')), { token: amira })).body.voteCount;
    expect((await call('PUT', url, { token: amira })).body).toEqual({ voteCount: before + 1, voted: true });
    expect((await call('PUT', url, { token: amira })).body).toEqual({ voteCount: before + 1, voted: true });
    expect((await call('PUT', url, { token: daniel })).body).toEqual({ voteCount: before + 2, voted: true });
    expect((await call('DELETE', url, { token: amira })).body).toEqual({ voteCount: before + 1, voted: false });
    expect((await call('DELETE', url, { token: amira })).body).toEqual({ voteCount: before + 1, voted: false });
    const own = await call('PUT', `${post(LA, thread(LA, 'order'))}/vote`, { token: amira });
    expect(own.body.error).toMatchObject({ code: 'conflict', message: "You can't mark your own post helpful." });
    // A hidden post: not for votes (and not even there, for students).
    expect((await call('PUT', `${post(LA, thread(LA, 'welcome', 'hugo'))}/vote`, { token: daniel })).body.error.message).toBe("This post can't be voted on.");
    expect((await call('PUT', `${post(LA, thread(LA, 'welcome', 'hugo'))}/vote`, { token: amira })).status).toBe(404);
  });
});

describe('moderation', () => {
  it('pins and locks threads only, accepts one reply only, and hides from everyone but author and moderators', async () => {
    const { call, signIn, server } = setup();
    const amira = await signIn('amira');
    const daniel = await signIn('daniel');
    const moderate = (id, body, token = daniel) => call('POST', `${post(LA, id)}/moderate`, { token, body });

    expect((await moderate(thread(LA, 'rotation'), { pinned: true }, amira)).body.error).toMatchObject({
      code: 'forbidden',
      message: 'Only a school instructor or above can do this.',
    });
    expect((await moderate(thread(LA, 'rotation', 'lucas'), { pinned: true })).body.error).toMatchObject({
      code: 'conflict',
      message: 'Only threads and lesson comments can be pinned or locked.',
    });
    expect((await moderate(thread(LA, 'rotation'), { accepted: true })).body.error.message).toBe('Only a reply can be the answer.');
    expect((await moderate(thread(LA, 'rotation'), {})).status).toBe(400);
    expect((await moderate(thread(LA, 'project-3d'), { locked: true })).body.error.message).toBe('This post was deleted.');

    const pinned = await moderate(thread(LA, 'rotation'), { pinned: true, locked: true });
    expect(pinned).toMatchObject({ status: 200, body: { pinned: true, locked: true } });
    expect((await call('GET', discussions(LA), { token: amira })).body.items.slice(0, 2).every((item) => item.pinned)).toBe(true);

    // One answer per thread.
    await moderate(thread(LA, 'rotation', 'daniel-2'), { accepted: true });
    const answered = (await call('GET', post(LA, thread(LA, 'rotation')), { token: amira })).body;
    expect(answered.replies.filter((reply) => reply.accepted).map((reply) => reply.id)).toEqual([thread(LA, 'rotation', 'daniel-2')]);

    // Hidden: the author and moderators still see it; everyone else, that it's hidden.
    const hidden = await moderate(thread(LA, 'order', 'kwame'), { hidden: true });
    expect(hidden.body).toMatchObject({ status: 'hidden', accepted: false, body: expect.stringContaining('f(g(x))') });
    const forAmira = (await call('GET', post(LA, thread(LA, 'order')), { token: amira })).body;
    expect(forAmira.replies.find((reply) => reply.id === thread(LA, 'order', 'kwame'))).toMatchObject({ status: 'hidden', body: '' });
    expect(forAmira.replyCount).toBe(3);
    expect((await moderate(thread(LA, 'order', 'kwame'), { accepted: true })).body.error.message).toBe("A hidden reply can't be the answer.");

    // A hidden thread: gone for others, there for its author, and it takes no replies.
    await moderate(thread(LA, 'study-group'), { hidden: true });
    expect((await call('GET', post(LA, thread(LA, 'study-group')), { token: amira })).status).toBe(404);
    expect((await call('GET', discussions(LA), { token: amira })).body.items.map((item) => item.id)).not.toContain(thread(LA, 'study-group'));
    expect((await call('POST', `${post(LA, thread(LA, 'study-group'))}/replies`, { token: daniel, body: { body: 'x' } })).status).toBe(409);
    // Hiding settled its open report.
    expect(server.db.find('reports', (row) => row.postId === thread(LA, 'study-group', 'adam'))?.resolvedAt).toBeNull();
    await moderate(thread(LA, 'study-group', 'adam'), { hidden: true });
    expect(server.db.find('reports', (row) => row.postId === thread(LA, 'study-group', 'adam'))).toMatchObject({ resolution: 'hidden' });
    // And back.
    expect((await moderate(thread(LA, 'study-group'), { hidden: false })).body.status).toBe('visible');
  });

  it('takes reports once, never of one’s own, and lets moderators hide the post or dismiss them', async () => {
    const { call, signIn, server } = setup();
    const amira = await signIn('amira');
    const daniel = await signIn('daniel');

    // The seeded queue: the open reports, oldest first, with where each post is.
    const queue = (await call('GET', `${discussions(LA)}/reports`, { token: daniel })).body;
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({
      reason: 'off_topic',
      reporter: { name: 'Noah Becker' },
      post: { id: thread(LA, 'study-group', 'adam'), reportCount: 1 },
      context: { threadId: thread(LA, 'study-group'), threadTitle: 'Anyone want to form a study group for the project?', lessonId: null, lessonTitle: null },
    });
    expect((await call('GET', `${discussions(SOUND)}/reports`, { token: daniel })).body[0]).toMatchObject({ reason: 'abuse', post: { id: thread(SOUND, 'beat-apps', 'oliver') } });
    expect((await call('GET', `${discussions(LA)}/reports`, { token: amira })).status).toBe(403);
    // Students don't see report counts.
    expect((await call('GET', post(LA, thread(LA, 'study-group')), { token: amira })).body.replies.every((reply) => reply.reportCount === 0)).toBe(true);

    const url = `${post(LA, thread(LA, 'rotation', 'lucas'))}/report`;
    expect((await call('POST', `${post(LA, thread(LA, 'order'))}/report`, { token: amira, body: { reason: 'spam' } })).body.error.message).toBe("You can't report your own post.");
    expect((await call('POST', url, { token: amira, body: { reason: 'rude' } })).status).toBe(400);
    const before = server.db.count('notifications', (row) => row.userId === userId('daniel') && row.type === 'discussion.reported');
    expect((await call('POST', url, { token: amira, body: { reason: 'off_topic', note: 'Not about rotations' } })).status).toBe(204);
    expect((await call('POST', url, { token: amira, body: { reason: 'spam' } })).body.error.message).toBe("You've already reported this post.");
    const told = server.db.filter('notifications', (row) => row.userId === userId('daniel') && row.type === 'discussion.reported');
    expect(told).toHaveLength(before + 1);
    expect(told.sort((a, b) => b.createdAt - a.createdAt)[0].data).toMatchObject({
      title: 'A post was reported in Linear Algebra, Visually',
      body: 'Reason: off topic. Have a look in the moderation queue.',
      path: `/s/grand-academy/c/${LA}/discussions/reports`,
    });
    expect((await call('POST', `${post(LA, thread(LA, 'welcome', 'hugo'))}/report`, { token: daniel, body: { reason: 'spam' } })).body.error.message).toBe(
      'This post is already out of view.',
    );

    // Dismiss one; hide settles the rest.
    const reports = (await call('GET', `${discussions(LA)}/reports`, { token: daniel })).body;
    expect(reports).toHaveLength(2);
    const resolve = (id, action) => call('POST', `${discussions(LA)}/reports/${id}/resolve`, { token: daniel, body: { action } });
    expect((await resolve(reports[1].id, 'dismiss')).status).toBe(204);
    expect((await resolve(reports[1].id, 'dismiss')).body.error.message).toBe('This report was already dealt with.');
    expect((await resolve(reports[0].id, 'hide')).status).toBe(204);
    expect((await call('GET', `${discussions(LA)}/reports`, { token: daniel })).body).toEqual([]);
    expect((await call('GET', post(LA, thread(LA, 'study-group')), { token: daniel })).body.replies.find((reply) => reply.id === thread(LA, 'study-group', 'adam'))).toMatchObject({
      status: 'hidden',
    });
    expect((await resolve('6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b', 'hide')).status).toBe(404);
    expect((await resolve(reports[0].id, 'erase')).status).toBe(400);
  });
});

describe('lesson comments', () => {
  it('lists a lesson’s comments with their replies, and keeps draft lessons to their editors', async () => {
    const { call, signIn, server, sent } = setup();
    const amira = await signIn('amira');
    const daniel = await signIn('daniel');
    const comments = (slug, key) => `${course(slug)}/lessons/${lessonId(slug, key)}/comments`;

    const page = (await call('GET', comments(SOUND, 'what-is-sound'), { token: amira })).body;
    expect(page.items.map((item) => item.id).sort()).toEqual([thread(SOUND, 'comment', 'headphones'), thread(SOUND, 'comment', 'shorter-waves')].sort());
    const asked = page.items.find((item) => item.id === thread(SOUND, 'comment', 'shorter-waves'));
    expect(asked).toMatchObject({ title: null, mine: true, answered: true, lesson: { id: lessonId(SOUND, 'what-is-sound'), title: 'What a sound wave looks like' } });
    expect(asked.replies[0]).toMatchObject({ accepted: true, author: { name: 'Daniel Okafor' } });
    // Lesson comments aren't course threads.
    expect((await call('GET', discussions(SOUND), { token: amira })).body.items.map((item) => item.id)).not.toContain(asked.id);

    const created = await call('POST', comments(SOUND, 'loudness'), { token: amira, body: { body: 'Is 0 dB silence?' } });
    expect(created).toMatchObject({ status: 201, body: { lesson: { id: lessonId(SOUND, 'loudness') }, title: null, replies: [] } });
    expect(sent({ event: 'discussion:changed' }).at(-1).payload).toMatchObject({ lessonId: lessonId(SOUND, 'loudness'), change: 'created' });
    const told = server.db.filter('notifications', (row) => row.userId === userId('daniel') && row.type === 'discussion.posted').sort((a, b) => b.createdAt - a.createdAt)[0];
    expect(told.data).toMatchObject({
      title: 'Amira Haddad commented on Loudness and amplitude',
      path: `/s/grand-academy/c/${SOUND}/l/${lessonId(SOUND, 'loudness')}?comment=${created.body.id}`,
    });
    await call('POST', `${post(SOUND, created.body.id)}/replies`, { token: daniel, body: { body: 'No: it’s the quietest sound most people can hear.' } });
    const reply = server.db.filter('notifications', (row) => row.userId === userId('amira') && row.type === 'discussion.reply').sort((a, b) => b.createdAt - a.createdAt)[0];
    expect(reply.data.title).toBe('Daniel Okafor replied to your comment on Loudness and amplitude');

    // A draft lesson: its editors only.
    expect((await call('GET', comments(SOUND, 'resonance'), { token: amira })).status).toBe(404);
    expect((await call('POST', comments(SOUND, 'resonance'), { token: daniel, body: { body: 'Note to self' } })).status).toBe(201);
    // Not enrolled: not even a free preview's comments.
    expect((await call('GET', comments('neural-networks', 'what-is-a-network'), { token: amira })).body.error.code).toBe('enrollment_required');
  });
});

describe('seeded notifications', () => {
  it('has told each persona about the conversations they’re part of', async () => {
    const { call, signIn } = setup();
    const amira = await signIn('amira');
    const mine = (await call('GET', '/notifications?limit=50', { token: amira })).body.items;
    const replies = mine.filter((item) => item.type === 'discussion.reply');
    expect(replies.length).toBeGreaterThanOrEqual(4);
    expect(replies.some((item) => item.readAt === null && item.data.title === 'Omar Siddiqui replied in “How fast did salt actually ruin Mesopotamian fields?”')).toBe(true);
    expect(mine.filter((item) => item.type.startsWith('live.')).map((item) => item.type)).toEqual(expect.arrayContaining(['live.scheduled', 'live.reminder', 'live.started']));

    const daniel = await signIn('daniel');
    const his = (await call('GET', '/notifications?limit=50', { token: daniel })).body.items;
    expect(his.filter((item) => item.type === 'discussion.reported' && item.readAt === null)).toHaveLength(2);
    expect(
      his.some((item) => item.type === 'discussion.posted' && item.data.title === 'Amira Haddad started a thread: Why does ten times the energy only sound twice as loud?'),
    ).toBe(true);
    expect(his.some((item) => item.type === 'live.reminder')).toBe(true);
  });
});

describe('saved state', () => {
  it('keeps the visitor’s posts, votes, reports and moderation across a reload, and resets to the seed', async () => {
    const storage = memoryStorage();
    const clock = { now: START };
    const first = setup({ storage, clock });
    const amira = await first.signIn('amira');
    const created = (await first.call('POST', discussions(LA), { token: amira, body: { title: 'Kept for later', body: 'Still here after a reload?' } })).body;
    await first.call('PUT', `${post(LA, thread(LA, 'rotation'))}/vote`, { token: amira });
    await first.call('POST', `${post(LA, thread(LA, 'rotation', 'lucas'))}/report`, { token: amira, body: { reason: 'other' } });
    const daniel = await first.signIn('daniel');
    await first.call('POST', `${post(LA, thread(LA, 'determinant-3d'))}/moderate`, { token: daniel, body: { locked: true } });

    clock.now += 60_000;
    const second = setup({ storage, clock });
    const token = await second.signIn('amira');
    expect((await second.call('GET', post(LA, created.id), { token })).body).toMatchObject({ title: 'Kept for later', mine: true });
    expect((await second.call('GET', post(LA, thread(LA, 'rotation')), { token })).body.voted).toBe(true);
    expect((await second.call('POST', `${post(LA, thread(LA, 'rotation', 'lucas'))}/report`, { token, body: { reason: 'spam' } })).status).toBe(409);
    expect((await second.call('GET', post(LA, thread(LA, 'determinant-3d')), { token })).body.locked).toBe(true);

    second.server.reset();
    const fresh = await second.signIn('amira');
    expect((await second.call('GET', post(LA, created.id), { token: fresh })).status).toBe(404);
    expect((await second.call('GET', post(LA, thread(LA, 'rotation')), { token: fresh })).body.voted).toBe(false);
    expect((await second.call('GET', post(LA, thread(LA, 'determinant-3d')), { token: fresh })).body.locked).toBe(false);
  });
});

describe('what each post says about itself', () => {
  it('says whether it’s answered and whether the viewer reported it, everywhere posts come back', async () => {
    const { call, signIn } = setup();
    const amira = await signIn('amira');
    const daniel = await signIn('daniel');

    // Lists: answered threads, and unanswered ones (no reply accepted, or none at all).
    const list = (await call('GET', `${discussions(LA)}?limit=50`, { token: amira })).body.items;
    const byId = new Map(list.map((item) => [item.id, item]));
    expect(byId.get(thread(LA, 'order'))).toMatchObject({ answered: true, reported: false });
    expect(byId.get(thread(LA, 'determinant-3d'))).toMatchObject({ answered: false });
    expect(byId.get(thread(LA, 'study-group'))).toMatchObject({ answered: false });
    for (const item of list) expect(typeof item.answered === 'boolean' && typeof item.reported === 'boolean').toBe(true);

    // A thread and its replies: replies are never "answered".
    const order = (await call('GET', post(LA, thread(LA, 'order')), { token: amira })).body;
    expect(order.answered).toBe(true);
    expect(order.replies.every((reply) => reply.answered === false && reply.reported === false)).toBe(true);

    // Reporting: the reporter sees it reported (still, once settled); others don't.
    const target = thread(LA, 'rotation', 'lucas');
    await call('POST', `${post(LA, target)}/report`, { token: amira, body: { reason: 'off_topic' } });
    const reply = (who) => call('GET', post(LA, thread(LA, 'rotation')), { token: who }).then((result) => result.body.replies.find((item) => item.id === target));
    expect(await reply(amira)).toMatchObject({ reported: true });
    expect(await reply(daniel)).toMatchObject({ reported: false, reportCount: 1 });
    const queue = (await call('GET', `${discussions(LA)}/reports`, { token: daniel })).body;
    const report = queue.find((item) => item.post.id === target);
    expect(report.post).toMatchObject({ reported: false, answered: false });
    await call('POST', `${discussions(LA)}/reports/${report.id}/resolve`, { token: daniel, body: { action: 'dismiss' } });
    expect(await reply(amira)).toMatchObject({ reported: true });
    expect(await reply(daniel)).toMatchObject({ reportCount: 0 });

    // A new reply, and lesson comments with theirs.
    const created = (await call('POST', `${post(LA, thread(LA, 'determinant-3d'))}/replies`, { token: daniel, body: { body: 'Volume, yes.' } })).body;
    expect(created).toMatchObject({ answered: false, reported: false });
    const accepted = (await call('POST', `${post(LA, created.id)}/moderate`, { token: daniel, body: { accepted: true } })).body;
    expect(accepted).toMatchObject({ accepted: true, answered: false });
    expect((await call('GET', post(LA, thread(LA, 'determinant-3d')), { token: amira })).body.answered).toBe(true);
    const comments = (await call('GET', `${course(SOUND)}/lessons/${lessonId(SOUND, 'what-is-sound')}/comments`, { token: amira })).body.items;
    expect(comments.find((item) => item.id === thread(SOUND, 'comment', 'shorter-waves'))).toMatchObject({ answered: true, reported: false });
    expect(comments.find((item) => item.id === thread(SOUND, 'comment', 'headphones'))).toMatchObject({ answered: false });
  });
});

describe('notification excerpts', () => {
  it('are plain text, as the worker writes them', () => {
    expect(excerpt('After **E**,\n\n- or after _F_?')).toBe('After E, or after F?');
    expect(plainText('## Key ideas\n> quoted\n1. one\n* two\nSee [the notes](https://example.com) and ![a sketch](x.png).')).toBe('Key ideas\nquoted\none\ntwo\nSee the notes and a sketch.');
    expect(plainText('Use `det = ad - bc`, ~~not this~~, and __bold__.')).toBe('Use det = ad - bc, not this, and bold.');
    // Not emphasis: snake_case and arithmetic stay as written.
    expect(plainText('snake_case_name and 2*3*4')).toBe('snake_case_name and 2*3*4');
    expect(plainText('```js\nconst x = 1;\n```')).toBe(' \nconst x = 1;\n ');
    const long = excerpt(`**${'word '.repeat(60).trim()}**`);
    expect(long.length).toBe(140);
    expect(long.endsWith('…')).toBe(true);
    expect(long).not.toMatch(/\*/);
  });

  it('read cleanly for new posts and replies, and in the seeded notifications', async () => {
    const { call, signIn, server } = setup();
    const amira = await signIn('amira');
    const daniel = await signIn('daniel');
    await call('POST', discussions(LA), { token: amira, body: { title: 'Shears and areas', body: 'Why does a **shear** keep its area?\n\n- the base stays\n- the _height_ stays' } });
    const posted = server.db.filter('notifications', (row) => row.userId === userId('daniel') && row.type === 'discussion.posted').sort((a, b) => b.createdAt - a.createdAt)[0];
    expect(posted.data.body).toBe('Why does a shear keep its area? the base stays the height stays');
    await call('POST', `${post(LA, thread(LA, 'order'))}/replies`, { token: daniel, body: { body: 'Try `RS` and `SR` on **î**.' } });
    const replied = server.db.filter('notifications', (row) => row.userId === userId('amira') && row.type === 'discussion.reply').sort((a, b) => b.createdAt - a.createdAt)[0];
    expect(replied.data.body).toBe('Try RS and SR on î.');

    // The seeded ones: no Markdown left in any body.
    const seeded = server.db.filter('notifications', (row) => row.type.startsWith('discussion.'));
    expect(seeded.length).toBeGreaterThan(10);
    for (const row of seeded) expect(row.data.body, row.data.title).not.toMatch(/\*\*|`|^\s*[-*+#>]\s|\]\(/m);
  });
});
