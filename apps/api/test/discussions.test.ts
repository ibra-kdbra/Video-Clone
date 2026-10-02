import postgres from 'postgres';
import type { Socket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest';
import { as, courseWithPeople, refused } from './fixtures.js';
import { connected, nextEvent, TestApi } from './helpers.js';

let api: TestApi;
let owner: postgres.Sql;
const sockets: Socket[] = [];

beforeAll(async () => {
  api = await TestApi.start();
  owner = postgres(inject('ownerDatabaseUrl'), { max: 1, onnotice: () => {} });
});
afterEach(() => {
  for (const socket of sockets.splice(0)) socket.close();
});
afterAll(async () => {
  await api.close();
  await owner.end();
});

type Post = { id: string; title: string | null; body: string; status: string; pinned: boolean; locked: boolean; accepted: boolean; replyCount: number; voteCount: number; voted: boolean; mine: boolean; author: { name: string; instructor: boolean } | null; reportCount: number };
type Thread = Post & { replies: Post[]; answered: boolean; lesson: { id: string; title: string } | null };

const outbox = (type: string, postId: string) => owner`select payload from outbox where type = ${type} and payload->>'postId' = ${postId}`;

describe('course threads', () => {
  it('starts threads, replies, and lists them pinned first with counts', async () => {
    const s = await courseWithPeople(api, owner);
    const student = as(api, s.student);
    const first = await student.post(`${s.url}/discussions`, { title: 'How do I picture a 3D vector?', body: 'I can do 2D, but 3D?' });
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ title: 'How do I picture a 3D vector?', mine: true, replies: [], answered: false, author: { name: 'Student One', instructor: false } });
    expect(await outbox('discussion.posted', first.body.id)).toHaveLength(1);

    const second = await as(api, s.other).post(`${s.url}/discussions`, { title: 'Study group?', body: 'Anyone want to meet on Thursdays?' });
    const reply = await as(api, s.author).post(`${s.url}/discussions/${first.body.id}/replies`, { body: 'Add a third axis coming out of the page.' });
    expect(reply.status).toBe(201);
    expect(reply.body).toMatchObject({ parentId: first.body.id, author: { instructor: true } });
    expect(await outbox('discussion.replied', reply.body.id)).toHaveLength(1);

    // Latest activity first: the answered thread moved up.
    let list = (await student.get(`${s.url}/discussions`)).body;
    expect(list.items.map((post: Post) => post.id)).toEqual([first.body.id, second.body.id]);
    expect(list.items[0]).toMatchObject({ replyCount: 1 });

    // Pinned leads whatever the order.
    await as(api, s.author).post(`${s.url}/discussions/${second.body.id}/moderate`, { pinned: true });
    list = (await student.get(`${s.url}/discussions?sort=new`)).body;
    expect(list.items.map((post: Post) => post.id)).toEqual([second.body.id, first.body.id]);

    // The thread, by its id or a reply's.
    const thread = (await student.get(`${s.url}/discussions/${reply.body.id}`)).body as Thread;
    expect(thread.id).toBe(first.body.id);
    expect(thread.replies.map((post) => post.id)).toEqual([reply.body.id]);

    // Replies are one level deep.
    expect((await student.post(`${s.url}/discussions/${reply.body.id}/replies`, { body: 'Nested?' })).status).toBe(409);
  });

  it('pages through threads and filters them', async () => {
    const s = await courseWithPeople(api, owner);
    const ids: string[] = [];
    for (let index = 0; index < 5; index++) {
      ids.push((await as(api, index % 2 ? s.other : s.student).post(`${s.url}/discussions`, { title: `Question number ${index}`, body: 'Body' })).body.id);
    }
    const page1 = (await as(api, s.student).get(`${s.url}/discussions?sort=new&limit=2`)).body;
    const page2 = (await as(api, s.student).get(`${s.url}/discussions?sort=new&limit=2&cursor=${page1.nextCursor}`)).body;
    const page3 = (await as(api, s.student).get(`${s.url}/discussions?sort=new&limit=2&cursor=${page2.nextCursor}`)).body;
    expect([...page1.items, ...page2.items, ...page3.items].map((post: Post) => post.id)).toEqual([...ids].reverse());
    expect(page3.nextCursor).toBeNull();
    expect((await as(api, s.student).get(`${s.url}/discussions?cursor=nonsense`)).status).toBe(400);

    // Mine: started or replied to.
    await as(api, s.student).post(`${s.url}/discussions/${ids[1]}/replies`, { body: 'Same question here.' });
    const mine = (await as(api, s.student).get(`${s.url}/discussions?filter=mine`)).body.items.map((post: Post) => post.id);
    expect(new Set(mine)).toEqual(new Set([ids[0], ids[1], ids[2], ids[4]]));

    // Unanswered: no accepted reply yet.
    const answer = await as(api, s.author).post(`${s.url}/discussions/${ids[3]}/replies`, { body: 'Here you go.' });
    await as(api, s.author).post(`${s.url}/discussions/${answer.body.id}/moderate`, { accepted: true });
    const unanswered = (await as(api, s.student).get(`${s.url}/discussions?filter=unanswered`)).body.items.map((post: Post) => post.id);
    expect(unanswered).not.toContain(ids[3]);
    expect(unanswered).toHaveLength(4);
  });

  it('is for the course’s editors and enrolled students only', async () => {
    const s = await courseWithPeople(api, owner);
    const thread = await as(api, s.student).post(`${s.url}/discussions`, { title: 'Members only?', body: 'Hello' });
    expect((await as(api, s.outsider).get(`${s.url}/discussions`)).body.error.code).toBe('enrollment_required');
    expect((await as(api, s.outsider).post(`${s.url}/discussions`, { title: 'Let me in', body: 'Please' })).status).toBe(403);
    expect((await as(api, s.outsider).get(`${s.url}/discussions/${thread.body.id}`)).status).toBe(403);
    // Editors, enrolled or not; and the school's admins.
    expect((await as(api, s.author).get(`${s.url}/discussions`)).status).toBe(200);
    expect((await as(api, s.head).get(`${s.url}/discussions/${thread.body.id}`)).status).toBe(200);
    // Another instructor isn't one of this course's editors.
    expect((await as(api, s.colleague).get(`${s.url}/discussions`)).status).toBe(403);
    // Checked like every input.
    expect((await as(api, s.student).post(`${s.url}/discussions`, { title: 'Hi', body: '' })).body.error.details.map((d: { path: string }) => d.path).sort()).toEqual(['body', 'title']);
  });
});

describe('editing, deleting and voting', () => {
  it('lets authors edit and delete their posts, leaving a placeholder when there are replies', async () => {
    const s = await courseWithPeople(api, owner);
    const thread = await as(api, s.student).post(`${s.url}/discussions`, { title: 'Original title', body: 'Original body' });
    const reply = await as(api, s.other).post(`${s.url}/discussions/${thread.body.id}/replies`, { body: 'A reply' });

    const edited = await as(api, s.student).patch(`${s.url}/discussions/${thread.body.id}`, { title: 'Better title', body: 'Better body' });
    expect(edited.body).toMatchObject({ title: 'Better title', body: 'Better body', editedAt: expect.any(String) });
    expect((await as(api, s.other).patch(`${s.url}/discussions/${thread.body.id}`, { body: 'Hijack' })).status).toBe(403);
    expect((await as(api, s.author).patch(`${s.url}/discussions/${thread.body.id}`, { body: 'Even moderators' })).status).toBe(403);
    expect((await as(api, s.other).patch(`${s.url}/discussions/${reply.body.id}`, { title: 'Replies have no titles', body: 'x' })).status).toBe(400);

    // With a reply: a placeholder, its text gone.
    expect((await as(api, s.student).del(`${s.url}/discussions/${thread.body.id}`)).status).toBe(204);
    const placeholder = (await as(api, s.other).get(`${s.url}/discussions/${thread.body.id}`)).body as Thread;
    expect(placeholder).toMatchObject({ status: 'deleted', title: null, body: '', author: null, mine: false });
    expect(placeholder.replies).toHaveLength(1);
    const [stored] = await owner`select title, body from discussion_posts where id = ${thread.body.id}`;
    expect(stored).toEqual({ title: '[deleted]', body: '[deleted]' });

    // Its last reply gone, the deleted thread goes too.
    expect((await as(api, s.other).del(`${s.url}/discussions/${reply.body.id}`)).status).toBe(204);
    expect((await as(api, s.other).get(`${s.url}/discussions/${thread.body.id}`)).status).toBe(404);
  });

  it('counts helpful votes, one per person, never your own', async () => {
    const s = await courseWithPeople(api, owner);
    const thread = await as(api, s.student).post(`${s.url}/discussions`, { title: 'Helpful?', body: 'Vote for me' });
    const url = `${s.url}/discussions/${thread.body.id}/vote`;
    expect((await as(api, s.other).put(url)).body).toEqual({ voteCount: 1, voted: true });
    expect((await as(api, s.other).put(url)).body).toEqual({ voteCount: 1, voted: true });
    expect((await as(api, s.author).put(url)).body).toEqual({ voteCount: 2, voted: true });
    expect((await as(api, s.student).put(url)).status).toBe(409);
    expect((await as(api, s.other).del(url)).body).toEqual({ voteCount: 1, voted: false });
    expect((await as(api, s.author).get(`${s.url}/discussions/${thread.body.id}`)).body).toMatchObject({ voteCount: 1, voted: true });
    // Top: most helpful first.
    const quiet = await as(api, s.other).post(`${s.url}/discussions`, { title: 'Quiet one', body: 'No votes' });
    expect((await as(api, s.student).get(`${s.url}/discussions?sort=top`)).body.items.map((post: Post) => post.id)).toEqual([thread.body.id, quiet.body.id]);
  });
});

describe('moderation', () => {
  it('hides posts from everyone but their author and the moderators', async () => {
    const s = await courseWithPeople(api, owner);
    const thread = await as(api, s.student).post(`${s.url}/discussions`, { title: 'Spammy thread', body: 'Buy my course' });
    const reply = await as(api, s.other).post(`${s.url}/discussions/${thread.body.id}/replies`, { body: 'A rude reply' });
    expect((await as(api, s.student).post(`${s.url}/discussions/${reply.body.id}/moderate`, { hidden: true })).status).toBe(403);

    await as(api, s.author).post(`${s.url}/discussions/${reply.body.id}/moderate`, { hidden: true });
    const forStudent = (await as(api, s.student).get(`${s.url}/discussions/${thread.body.id}`)).body as Thread;
    expect(forStudent.replies[0]).toMatchObject({ status: 'hidden', body: '' });
    expect(forStudent.replyCount).toBe(0);
    expect((await as(api, s.other).get(`${s.url}/discussions/${thread.body.id}`)).body.replies[0]).toMatchObject({ status: 'hidden', body: 'A rude reply' });
    expect((await as(api, s.author).get(`${s.url}/discussions/${thread.body.id}`)).body.replies[0]).toMatchObject({ body: 'A rude reply' });

    // A hidden thread: gone for others.
    await as(api, s.author).post(`${s.url}/discussions/${thread.body.id}/moderate`, { hidden: true });
    expect((await as(api, s.other).get(`${s.url}/discussions/${thread.body.id}`)).status).toBe(404);
    expect((await as(api, s.other).get(`${s.url}/discussions`)).body.items).toEqual([]);
    expect((await as(api, s.student).get(`${s.url}/discussions`)).body.items).toHaveLength(1);
    // Hidden things take no replies.
    expect((await as(api, s.author).post(`${s.url}/discussions/${thread.body.id}/replies`, { body: 'x' })).status).toBe(409);
  });

  it('locks threads, pins only threads, and accepts one reply as the answer', async () => {
    const s = await courseWithPeople(api, owner);
    const thread = await as(api, s.student).post(`${s.url}/discussions`, { title: 'What is a basis?', body: 'Confused' });
    const a = await as(api, s.other).post(`${s.url}/discussions/${thread.body.id}/replies`, { body: 'Two arrows' });
    const b = await as(api, s.author).post(`${s.url}/discussions/${thread.body.id}/replies`, { body: 'Independent vectors that span the space.' });
    const moderate = (id: string, body: object) => as(api, s.author).post(`${s.url}/discussions/${id}/moderate`, body);

    expect((await moderate(a.body.id, { pinned: true })).status).toBe(409);
    expect((await moderate(thread.body.id, { accepted: true })).status).toBe(409);
    await moderate(a.body.id, { accepted: true });
    await moderate(b.body.id, { accepted: true });
    const accepted = (await as(api, s.student).get(`${s.url}/discussions/${thread.body.id}`)).body as Thread;
    expect(accepted.answered).toBe(true);
    expect(accepted.replies.map((post) => post.accepted)).toEqual([false, true]);

    await moderate(thread.body.id, { locked: true });
    expect((await as(api, s.student).post(`${s.url}/discussions/${thread.body.id}/replies`, { body: 'Thanks!' })).status).toBe(409);
    expect((await as(api, s.author).post(`${s.url}/discussions/${thread.body.id}/replies`, { body: 'Locked now.' })).status).toBe(201);
    const [audit] = await owner`select count(*)::int as n from audit_log where action = 'discussion.moderated' and target_id = ${thread.body.id}`;
    expect(audit!.n).toBe(1);
  });

  it('takes reports once, and lets moderators hide the post or dismiss them', async () => {
    const s = await courseWithPeople(api, owner);
    const thread = await as(api, s.student).post(`${s.url}/discussions`, { title: 'Off topic', body: 'Anyone watching the match?' });
    const reportUrl = `${s.url}/discussions/${thread.body.id}/report`;
    expect((await as(api, s.student).post(reportUrl, { reason: 'spam' })).status).toBe(409);
    expect((await as(api, s.other).post(reportUrl, { reason: 'off_topic', note: 'Not about algebra' })).status).toBe(204);
    expect((await as(api, s.other).post(reportUrl, { reason: 'spam' })).body.error.message).toMatch(/already reported/);
    expect((await as(api, s.head).post(reportUrl, { reason: 'other' })).status).toBe(204);
    expect(await owner`select 1 from outbox where type = 'discussion.reported' and payload->>'postId' = ${thread.body.id}`).toHaveLength(2);

    expect((await as(api, s.student).get(`${s.url}/discussions/reports`)).status).toBe(403);
    const reports = (await as(api, s.author).get(`${s.url}/discussions/reports`)).body;
    expect(reports).toHaveLength(2);
    expect(reports[0]).toMatchObject({ reason: 'off_topic', note: 'Not about algebra', reporter: { name: 'Student Two' }, post: { id: thread.body.id, reportCount: 2 }, context: { threadId: thread.body.id, threadTitle: 'Off topic' } });
    expect((await as(api, s.author).get(`${s.url}/discussions/${thread.body.id}`)).body.reportCount).toBe(2);
    expect((await as(api, s.other).get(`${s.url}/discussions/${thread.body.id}`)).body.reportCount).toBe(0);

    // Dismiss one; hide settles the rest.
    expect((await as(api, s.author).post(`${s.url}/discussions/reports/${reports[1].id}/resolve`, { action: 'dismiss' })).status).toBe(204);
    expect((await as(api, s.author).post(`${s.url}/discussions/reports/${reports[1].id}/resolve`, { action: 'dismiss' })).status).toBe(409);
    expect((await as(api, s.author).post(`${s.url}/discussions/reports/${reports[0].id}/resolve`, { action: 'hide' })).status).toBe(204);
    expect((await as(api, s.author).get(`${s.url}/discussions/reports`)).body).toEqual([]);
    expect((await as(api, s.author).get(`${s.url}/discussions/${thread.body.id}`)).body.status).toBe('hidden');
  });
});

describe('lesson comments', () => {
  it('lists a lesson’s comments with their replies, and keeps draft lessons to their editors', async () => {
    const s = await courseWithPeople(api, owner);
    const comments = `${s.url}/lessons/${s.lessons.vectors}/comments`;
    const comment = await as(api, s.student).post(comments, { body: 'Is a vector always from the origin?' });
    expect(comment.status).toBe(201);
    expect(comment.body).toMatchObject({ title: null, lesson: { id: s.lessons.vectors, title: 'Vectors as arrows' } });
    await as(api, s.author).post(`${s.url}/discussions/${comment.body.id}/replies`, { body: 'In linear algebra, yes.' });
    const page = (await as(api, s.other).get(comments)).body;
    expect(page.items).toHaveLength(1);
    expect(page.items[0].replies.map((reply: Post) => reply.body)).toEqual(['In linear algebra, yes.']);
    // Lesson comments aren't course threads.
    expect((await as(api, s.other).get(`${s.url}/discussions`)).body.items).toEqual([]);
    // Its thread knows its lesson.
    expect((await as(api, s.other).get(`${s.url}/discussions/${comment.body.id}`)).body.lesson).toEqual({ id: s.lessons.vectors, title: 'Vectors as arrows' });

    expect((await as(api, s.student).get(`${s.url}/lessons/${s.lessons.draft}/comments`)).status).toBe(404);
    expect((await as(api, s.author).post(`${s.url}/lessons/${s.lessons.draft}/comments`, { body: 'Note to self' })).status).toBe(201);
    expect((await as(api, s.outsider).get(comments)).status).toBe(403);
  });
});

describe('live updates', () => {
  it('tells people watching the course when its discussions change, and only them', async () => {
    const s = await courseWithPeople(api, owner);
    const watcher = await api.socket(s.other.token);
    const outsider = await api.socket(s.outsider.token);
    sockets.push(watcher, outsider);
    await Promise.all([connected(watcher), connected(outsider)]);
    expect(await watcher.emitWithAck('course:watch', { courseId: s.courseId })).toEqual({ ok: true });
    expect(refused(await outsider.emitWithAck('course:watch', { courseId: s.courseId }))).toBe('enrollment_required');
    expect(refused(await watcher.emitWithAck('course:watch', { courseId: crypto.randomUUID() }))).toBe('not_found');

    const changed = nextEvent<{ courseId: string; threadId: string; change: string }>(watcher, 'discussion:changed');
    const thread = await as(api, s.student).post(`${s.url}/discussions`, { title: 'Live update?', body: 'Ping' });
    expect(await changed).toMatchObject({ courseId: s.courseId, threadId: thread.body.id, postId: thread.body.id, change: 'created', lessonId: null });
  });
});
