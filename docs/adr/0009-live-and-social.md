# 9. Live classes, discussions and search

**Status:** accepted, 2026-10-02

## Context
Phase 3 makes Grand LMS a place where people meet, not just a library of lessons:
- classes held live, at a set time, with a waiting room and chat
- comments under lessons and discussion threads for each course, kept civil by moderation
- search across everything a school teaches

Two constraints shape the design. It must stay free to run, on one small server. And the public
demo has no server at all, so every feature also has to work against the in-browser mock.

## Decision
- **Live classes are scheduled sessions of a course** (`live_sessions`). They're scheduled,
  started, ended or cancelled by the course's editors. Enrolled students see them, get a reminder
  15 minutes before, and are told when one starts.
- **The video comes from one of three places, chosen per class**:
  - **LiveKit** (`livekit`): WebRTC in the browser, through a LiveKit server the school runs next
    to the API. It's open source and runs on the same free server. The API signs a short-lived
    token for each person. Hosts publish their camera, microphone and screen; students watch and
    listen. A host can let a student speak (a raised hand turns into microphone and camera rights),
    which the API grants through LiveKit's server API. Offered only when `LIVEKIT_*` is configured.
  - **YouTube Live** (`youtube`): the host streams from YouTube Studio or OBS, and the class page
    embeds it. The replay stays on the same video afterwards.
  - **A meeting link** (`link`): Zoom, Meet or anything else, opened in a new tab when it's time.
- **The waiting room and chat are ours, whatever the video**. They run over the existing
  Socket.IO connection, in a room per class:
  - The class page shows who's there and the chat from 15 minutes before the start.
  - Messages are stored, so the chat becomes a transcript. Hosts can hide a message.
  - Sending is limited per person.
  - Attendance (first joined, last seen) is recorded for the hosts.
- **Discussions are one table of posts in three shapes**:
  - a course thread (with a title)
  - a comment under a lesson
  - a reply to either, one level deep
  Readers are the course's editors and its enrolled students. People mark posts helpful.
- **Moderation belongs to the course's editors**:
  - They pin and lock threads, hide posts, and mark the reply that answers a question.
  - They work through reports, which members file with a reason; reporting is once per person and
    post.
  - Hidden posts stay visible to their author and the moderators. Deleted posts that have replies
    leave a placeholder; deleted posts without replies are removed.
- **Search uses Postgres full text** (`tsvector` columns that Postgres generates, GIN indexes,
  English stemming):
  - Titles weigh most, then summaries, then the long text. The last word typed matches as a
    prefix.
  - Results respect what the viewer may see: published courses (drafts for their editors), the
    lessons in them (marked locked if the viewer isn't enrolled), and the discussions of courses
    they take part in.
  - Snippets mark matches with two control characters, never HTML, so the page can't be tricked
    into rendering markup.
- **Everything goes through the outbox**: new threads and replies, reports, classes scheduled or
  started. The worker turns them into notifications, as in Phase 2.

## API
All routes are under `/api/v1/schools/:slug`. `C` stands for `/courses/:courseSlug`.

| Route | Who | What |
| --- | --- | --- |
| `GET /search?q&type&limit&offset` | members | `SearchResults` |
| `GET /live/options` | members | `LiveOptions`: the providers this server offers |
| `GET /live?when=upcoming\|past` | members | `LiveSession[]` for courses you take or teach |
| `GET C/live?when` | course viewers | `LiveSession[]` |
| `POST C/live` | editors | schedule: `LiveSession` |
| `GET C/live/:id` | course viewers | `LiveSession` |
| `PATCH C/live/:id` | editors | details, stream, recording |
| `POST C/live/:id/start` · `/end` · `/cancel` | editors | change its status |
| `DELETE C/live/:id` | editors | remove a class that hasn't started |
| `GET C/live/:id/messages?before&limit` | joiners | chat history, newest last |
| `POST C/live/:id/messages/:messageId/hide` | editors | hide a message |
| `GET C/live/:id/attendance` | editors | who came |
| `POST C/live/:id/token` | joiners | `LiveKitAccess` (LiveKit classes, once live; hosts any time before the end) |
| `POST C/live/:id/speakers/:userId` | editors | `{ allowed }`: let a student speak, or stop them |
| `GET C/discussions?sort&filter&cursor&limit` | readers | course threads |
| `POST C/discussions` | readers | new thread: `DiscussionThread` |
| `GET C/discussions/:postId` | readers | the thread or lesson comment, with replies |
| `POST C/discussions/:postId/replies` | readers | reply (not in a locked thread, except moderators) |
| `PATCH C/discussions/:postId` | author | edit |
| `DELETE C/discussions/:postId` | author, moderators | delete |
| `PUT` / `DELETE C/discussions/:postId/vote` | readers | helpful, or not: `{ voteCount, voted }` |
| `POST C/discussions/:postId/moderate` | moderators | pin, lock, hide, accept |
| `POST C/discussions/:postId/report` | readers (not their own post) | report |
| `GET C/discussions/reports` | moderators | open reports |
| `POST C/discussions/reports/:reportId/resolve` | moderators | `{ action: hide \| dismiss }` |
| `GET C/lessons/:lessonId/comments?sort&cursor&limit` | lesson readers | comments with replies |
| `POST C/lessons/:lessonId/comments` | lesson readers | new comment |

Socket.IO events are listed in `packages/contracts/src/realtime.ts`: `course:watch`,
`live:join`, `live:message` and `live:hand`, and the server's `discussion:changed` and `live:*`.

Notification paths:
- `/s/:slug/c/:course/discussions/:threadId`
- `/s/:slug/c/:course/l/:lessonId?comment=:threadId`
- `/s/:slug/c/:course/discussions/reports`
- `/s/:slug/c/:course/live/:sessionId`

## Consequences
- **LiveKit is optional.** A school without it schedules YouTube or link classes, and loses
  nothing else.
- **LiveKit's ports.** It needs a TCP port and a UDP port open on the server, alongside Caddy's.
  There's no TURN relay, so a few very locked-down networks can't connect; those students can use
  a YouTube or link class.
- **Two kinds of state.** Chat and attendance live in Postgres. Hands raised and who may speak are
  kept in Redis for the length of the class.
- **Search limits.** Search is per school and English-stemmed. Schools teaching in other languages
  get exact-word matching only, until a per-school language setting exists.
- **The demo.** It runs all of this in the browser: a live class with scripted classmates in the
  chat, seeded discussions to moderate, and search over the demo school.
