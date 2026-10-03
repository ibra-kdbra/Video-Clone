# Architecture

Grand LMS is a learning platform for many schools at once, built around video. This page describes
what is built so far:
- **Phase 0**, the foundation every later feature stands on: accounts, schools and their members,
  invitations, real-time updates, background jobs and the security model.
- **Phase 1**, courses and video lessons: course outlines, drafts and publishing, enrollments,
  uploads straight to storage, transcoding to adaptive HLS, and signed playback.
- **Phase 2**, learning progress: what students watched and completed, quizzes graded on the
  server, assignments with files and feedback, notifications in the app and by email, and
  insights for a course's editors.
- **Phase 3**, live and social: live classes with a waiting room and chat (video through LiveKit,
  YouTube Live or a meeting link), lesson comments and course discussions with moderation, and
  full-text search across a school.

The decisions behind it are recorded in [docs/adr](adr).

## The pieces

```text
                    ┌───────────────────────────── Netlify (free) ──────────────────────────────┐
browser ──https──►  │ apps/web: React app (static)                                              │
                    │ /api/*      → video proxy function (embedded lesson videos' details)      │
                    │ /api/v1/*   → proxied to the API server (same origin: first-party cookie) │
                    └──────────────────────────────────────┬────────────────────────────────────┘
                                                           │ https
browser ──wss (Socket.IO, ticket sign-in)───────────┐      │
browser ──https (signed URLs: uploads, video)───┐   │      │
                                                ▼   ▼      ▼
                    ┌─────────── one small server (Oracle Cloud Always Free) ───────────────────┐
                    │ Caddy (HTTPS, Let's Encrypt)                                              │
                    │   ├► apps/api: NestJS 12 on Fastify, REST /api/v1 + Socket.IO /api/v1/ws  │
                    │   ├► Garage (S3 API) at MEDIA_DOMAIN: uploads, segments, posters          │
                    │   └► LiveKit (optional) at LIVE_DOMAIN: live classes over WebRTC          │
                    │ apps/worker: outbox relay, BullMQ jobs, email, ffmpeg transcoding         │
                    │ PostgreSQL 17 (row-level security)     Redis 8 (queues, limits, pub/sub)  │
                    └───────────────────────────────────────────────────────────────────────────┘
```

| Package | What it is |
| --- | --- |
| `apps/web` | The React app (Vite, React Router, TanStack Query, Motion, Sass modules). Also the Netlify function that looks up the title, pictures and length of the YouTube, Dailymotion and Twitch videos that lessons embed, keeping the platforms' keys on the server. |
| `apps/api` | The HTTP and WebSocket API. |
| `apps/worker` | Background work: moves outbox events into BullMQ, sends email and notifications, transcodes videos with ffmpeg, cleans up expired rows and abandoned uploads. |
| `packages/contracts` | The API contract shared by all three: zod schemas for every request body, response types, real-time event types. |

## A request, end to end

1. The browser calls `/api/v1/...` on the web app's own origin. Netlify proxies it to the API, so
   the refresh cookie is first-party and the browser needs no CORS.
2. Caddy terminates TLS and forwards the request to the API.
3. Fastify gives it a request id: a well-formed incoming `X-Request-Id` is kept, otherwise one is
   generated. The id is returned in the response, logged by pino, and included in every error body.
4. Guards run in this order:
   1. `AuthGuard` checks the bearer token (JWT, HS256, issuer, audience, type, expiry), then asks
      Redis whether the session was revoked.
   2. `RateLimitGuard` counts per person, or per address when signed out, in a Redis sliding window.
   3. On school routes, `SchoolAccessGuard` loads the school named by `:slug` and the caller's role,
      and compares it with the role the route needs.
5. The route's zod schema validates the body, query or parameters (`@Body({ schema })`, through
   Nest 12's Standard Schema support). Unknown fields are rejected, and the handler gets typed,
   trimmed and normalized input.
6. The service runs its queries in `DatabaseService.transaction({ userId, schoolId }, ...)`, which
   sets `app.user_id` and `app.school_id` for that transaction only. Row-level security reads them.
7. Changes that others need to hear about are written in the same transaction:
   - an audit entry (`audit_log`)
   - an outbox event (`outbox`), which the worker turns into jobs
8. After the commit, real-time events go to the school's Socket.IO room.
9. Every error comes back as `{ "error": { "code", "message", "details"?, "requestId" } }`. The
   codes are listed in `ApiErrorCode` in `packages/contracts`. Unexpected errors are logged and
   answered with a generic 500, so no SQL or stack trace ever leaves the server.

## Schools and row-level security

- Every school-scoped table has a `school_id`, and Postgres itself enforces the separation
  ([ADR 2](adr/0002-row-level-security.md)).
- The API connects as `grand_app`, a role that owns nothing, so policies always apply to it.
- Migrations run as the owner.
- `app.current_school_id()` and `app.current_user_id()` read the transaction's settings:

| Table | `grand_app` may | Policy |
| --- | --- | --- |
| `schools` | read, create, update | Anyone reads the public details; you create schools only in your own name; you update only the school the transaction acts for. |
| `memberships` | read, create, update, delete | Only the acting school's rows, plus read access to your own memberships in every school (your school list). |
| `invitations` | read, create, update | Only the acting school's rows. Someone holding a link finds it through `app.invitation_by_token(hash)`, a `SECURITY DEFINER` function that returns exactly one row. |
| `audit_log` | read, add | Append-only (no update or delete grants). Entries for another school are refused. |
| `courses`, `course_modules`, `lessons`, `media_assets` | read, create, update, delete | Only the acting school's rows. Who may see or edit which course is decided in the API (below), on top of this. |
| `enrollments` | read, create, delete | Only the acting school's rows, plus read access to your own enrollments. |
| `school_storage` | read, update | Only the acting school's row. A trigger creates it with every school. |
| `lesson_progress`, `quizzes`, `assignments`, `assignment_submissions`, `submission_files` | read, create, update, delete | Only the acting school's rows. Whose progress or submission you see is decided in the API, as for courses. |
| `quiz_attempts` | read, add | Only the acting school's rows. Attempts are never changed or deleted, except with their lesson or membership. |
| `notifications` | read, update, delete | Only your own, in any school. There's no insert grant: they're written through `app.add_notifications(...)`, a `SECURITY DEFINER` function that only writes for members of the acting school. |
| `live_sessions`, `live_attendance`, `discussion_posts`, `discussion_votes`, `discussion_reports` | read, create, update, delete | Only the acting school's rows. Who may see, join or moderate is decided in the API, as for courses. |
| `live_messages` | read, add, hide | Only the acting school's rows. Only `hidden_at` and `hidden_by` can be updated, so a message's text can't be rewritten, and there's no delete grant. |
| `users`, `sessions`, `refresh_tokens`, `outbox` | as granted | Not school-scoped. They're reached only through the services, by id or by token hash. |

There are more guarantees:
- One owner per school is a partial unique index.
- An open invitation per address and school is another.
- Addresses are stored lower-cased, and a `CHECK` constraint enforces it.
- Transactions time out: a statement after 10 s, an idle transaction after 15 s.
- Course tables reference each other through composite keys that include the school:
  `(course_id, school_id)` and `(module_id, course_id)`. A lesson can't point at another school's
  course, or at a module of another course, even if a bug in the API tried.
- Progress, attempts and submissions point at `(lesson_id, course_id, school_id)` and at the
  person's membership `(school_id, user_id)`. Leaving a school deletes them.
- Discussion posts, chat messages and reports also point at the membership, but leaving a school
  keeps them, unsigned (`ON DELETE SET NULL (author_id)`). A reply points at its parent through
  `(parent_id, course_id, school_id)`, so it can't hang under another course's thread.
- The socket knows a course's or a class's id before it knows the school.
  `app.course_school(id)` and `app.live_session_school(id)` (`SECURITY DEFINER`) return only the
  school id; access is then checked acting for that school.

`apps/api/test/rls.test.ts` checks all of this straight against Postgres as `grand_app`:
- queries with no school filter at all
- inserts forged into another school
- attempts to disable RLS
- settings leaking between pooled connections

## Signing in

See [ADR 3](adr/0003-sessions-and-tokens.md).

- **Passwords**:
  - Argon2id with OWASP's minimum settings (19 MiB of memory, 2 passes).
  - Hashes made with weaker settings are upgraded at the next login.
  - An unknown address is checked against a dummy hash, so it takes as long to answer as a wrong password.
  - Ten failed logins lock that address for 15 minutes. There is also a per-address request limit.
- **Access tokens**:
  - JWTs valid for 15 minutes, held in the page's memory only, never in storage.
  - They carry the session id, so ending a session blocks its tokens at once: Redis holds a
    revocation marker for as long as a token could still be valid.
- **Refresh tokens**:
  - 32 random bytes in an httpOnly, `SameSite=Strict` cookie that only `/api/v1/auth` receives.
  - Stored as SHA-256 hashes.
  - Each one works once: using it issues the next.
  - Presenting a used one again means it was copied, so the whole session ends, for both copies.
  - Claiming a token is a single atomic `UPDATE`, so two simultaneous refreshes can't both win.
  - The refresh and logout routes also require the web app's `Origin`.
- **Devices**: `/auth/sessions` lists signed-in devices, and any of them can be signed out. Its
  WebSockets are disconnected immediately.

## Real-time

See [ADR 5](adr/0005-realtime.md).

- Socket.IO runs on the API's own port at `/api/v1/ws`. It accepts WebSocket transport only, and
  only from the web app's origins.
- **Signing in**:
  - The app first asks `POST /realtime/ticket` for a ticket: random, valid for 30 seconds, and
    usable once (Redis `GETDEL`).
  - The ticket goes in the Socket.IO handshake, not in the URL.
  - A middleware refuses the connection when the ticket is missing, already used, or its session was revoked.
- **Rooms**:
  - `user:{id}` and `session:{id}` are joined automatically.
  - `school:{id}` is joined after a membership check.
  - `school:{id}:staff` is joined too by instructors and above, and follows role changes. Video
    progress goes only there.
  - The Redis adapter shares the rooms across API instances.
  - `course:{id}` is joined on request (`course:watch`) by those who may read the course's
    discussions. New, edited and moderated posts are announced there (`discussion:changed`) so
    open pages refresh.
  - `live:{id}` is joined with `live:join` by those who may be in the class now (below).
- **Events**:
  - Members joining, changing role or leaving.
  - Presence: who is connected to a school.
  - Session revoked.
  - A new notification, and notifications read on another device (`user:{id}` only).
  - In a class: chat messages and hidden ones, who's there with raised hands, the class starting
    or ending, and a student allowed to speak.
- **After commit**: an event about a change is queued with `DatabaseService.afterCommit` and sent
  once the transaction has committed (never if it rolls back), so a page that refetches on hearing
  it sees the change.
- **Limits**:
  - 16 KiB per message.
  - 20 events in a burst, then 5 a second.
  - A client that keeps exceeding the limit is disconnected.

## Background work

See [ADR 4](adr/0004-outbox.md).

1. The API writes events to the `outbox` table in the same transaction as the change they
   describe, so none is lost and none is sent for a change that rolled back.
2. A trigger sends `NOTIFY outbox` on commit.
3. The worker's relay wakes on the notification, and also polls every 5 s as a safety net.
4. It claims rows with `FOR UPDATE SKIP LOCKED` and adds them to BullMQ with the job id
   `outbox-{id}`, so a re-published event is never queued twice.
5. Jobs retry with exponential backoff (8 attempts).
6. The processor checks `processed_at` first and sets it last. A crash can repeat an email, but
   never lose one.
7. Secrets in a payload (the invitation link) are deleted once handled.
8. BullMQ job schedulers run the nightly clean-up and, every minute, the live classes job. Only
   one worker runs each, however many are up. The live classes job:
   - claims classes starting within 15 minutes that haven't had their reminder
     (`app.claim_live_reminders`, `FOR UPDATE SKIP LOCKED`), and sends it once
   - ends classes still live two hours after their end, and cancels scheduled ones that never
     started (`app.close_stale_live`)

## Courses and lessons

- **Shape**: a school has courses, and each course has modules holding lessons. A lesson has notes
  in Markdown. It's one of three kinds, fixed when it's created:
  - a *lesson*, with optionally one video: an upload, or a YouTube, Dailymotion or Twitch embed
    (the web app's video proxy looks up the embed's title, picture and length)
  - a *quiz*
  - an *assignment*
- **Addresses**: a course's slug is made from its title and is unique within the school. A clash
  gets `-2`, `-3` and so on.
- **Who may do what** (`apps/api/src/courses/course-access.ts`):

| Role | Courses |
| --- | --- |
| Owner, admin | Create, edit and delete every course. |
| Instructor | Create courses; edit and delete the ones they created. |
| Student (and anyone else) | See published courses. Enroll in them, then watch their published lessons. Lessons marked as a free preview play without enrolling. |

- **Drafts and publishing**: courses and lessons start as drafts.
  - Only a course's editors see drafts. Anyone else gets "not found", so a draft's address gives
    nothing away.
  - Publishing a course records when, and adds a `course.published` event to the outbox. The
    first time a lesson of a published course is published, a `lesson.published` event follows.
    Archiving hides a course from the catalog but keeps it for its editors.
- **Outline**: `PUT .../outline` reorders modules and lessons and moves lessons between modules,
  all in one request.
  - The request must list every module and lesson exactly once, otherwise the answer is a 409.
  - Positions are unique per course and per module. The unique constraints are checked when the
    transaction commits, so any reshuffle works in one statement batch.
  - A course always keeps at least one module.
- **Deleting**: removing a course, module or lesson deletes its rows, then queues its uploaded
  videos for deletion. The worker removes their files and frees their storage.

## Video

See [ADR 7](adr/0007-video-pipeline.md).

```text
browser                API                       storage (Garage)          worker
  │ start upload ───────►│ reserve quota            │                         │
  │◄─ signed part URLs ──│ create multipart ───────►│                         │
  │ PUT parts (16 MiB) ────────────────────────────►│                         │
  │ complete ───────────►│ check size, outbox ──────┼── media.uploaded ──────►│ download original
  │                      │                          │◄─ HLS ladder, poster ───│ ffmpeg
  │◄──────────── media:updated (progress, ready) over Socket.IO ──────────────│
  │ playback ───────────►│ enrolled? token          │                         │
  │ master.m3u8?t=… ────►│ rewritten playlists      │                         │
  │ segments (signed) ─────────────────────────────►│                         │
```

- **Quota**: each school has a quota (2 GiB by default) in `school_storage`.
  - Starting an upload reserves the declared size, with the row locked, so parallel uploads can't
    overrun the quota.
  - Completing it turns the reservation into used space. The worker then corrects that to the
    size of the transcoded files.
  - Deleting a video frees its space.
- **Upload checks**:
  - Only video types (MP4, QuickTime, WebM, Matroska) up to `MEDIA_MAX_UPLOAD_BYTES` are accepted.
  - Part URLs last an hour. A slow upload asks for fresh ones.
  - Completion fails, and frees everything, if the stored size differs from the declared one.
- **Transcoding** (`apps/worker/src/media`):
  - ffprobe reads the file first: duration, size, rotation and audio. A file it can't read, or one
    longer than `MEDIA_MAX_DURATION_SECONDS`, fails with a reason the instructor sees.
  - One ffmpeg run splits the video into the qualities at or below the source's (1080p, 720p,
    480p, 360p) as fragmented-MP4 HLS. Keyframes come every 2 seconds, in 6-second segments.
  - Two more runs make the poster and the storyboard sprites.
  - Progress goes into `media_assets.progress`, and out to the school's staff room as
    `media:updated`, at most every 2 seconds. Students' pages check back every 15 seconds instead.
  - A job is retried once. If the video was deleted or replaced while it was transcoding, the
    result is thrown away.
- **Playback**:
  - `GET .../lessons/:id/playback` checks that the viewer may watch the lesson. It returns the
    embed, a "still processing" state, or an HLS address with a signed poster and storyboard.
  - The HLS address is `/api/v1/media/{school}/{video}/master.m3u8?t={token}`. The token is
    `expiry.HMAC-SHA256(school/video/expiry)`, under a key derived from `JWT_SECRET` for this use
    only.
  - The API rewrites the master playlist to pass the token on to each quality. It rewrites the
    quality playlists so every init and media segment is a presigned GET on storage. These are
    cached per hour-long signing window.
  - The web app plays the stream with hls.js. Workers are off, because the page's CSP has
    `worker-src 'none'`. The CSP allows `MEDIA_ORIGIN` for images, media and fetches.

## Progress

See [ADR 8](adr/0008-learning-progress.md).

- **What's recorded**: one `lesson_progress` row per student and lesson, created on the first
  report. Only enrolled students have rows. Previews and editors looking around leave none.
- **Watching**:
  - Every ~10 seconds, and when the page is hidden, the player sends
    `PUT .../lessons/:id/progress` with the 5-second stretches that played normally since the last
    report, and the position.
  - The API ORs the stretches into a bitset (`watched`, 1 bit per stretch), with the row locked.
    Replays count once, and skipping ahead counts nothing.
  - An uploaded video's lesson completes once 90% of its stretches have played.
  - The position is kept for resuming.
- **Completing by hand**: `POST .../complete` for a lesson without an uploaded video. Quizzes
  complete when passed, assignments when handed in. Completion is never undone.
- **Where it shows**: in each lesson summary (`progress: { completed, percent }`), in the course
  page (`progress`: lessons done, percent, the last lesson for "Continue"), in the catalog's "My
  courses", and in the Students tab for editors.

## Quizzes

- **Shape**: a quiz has a pass mark (70% by default), an optional attempt limit, and up to 100
  questions: one answer, several answers, or a short typed answer. Editors save all of it at once
  with `PUT .../quiz`; question and choice ids are kept across edits.
- **Taking it**:
  - `GET .../quiz` gives the questions without answers, the person's attempts, and how many are
    left.
  - `POST .../quiz/attempts` grades the answers on the server. Choice questions are all or
    nothing. Short answers match ignoring case, accents, spacing and final punctuation.
  - An advisory lock on the quiz and person makes the attempt limit exact, even for parallel
    requests.
  - Each attempt stores its marks, so editing a quiz later doesn't change past scores.
  - The right answers and explanations are only returned once the quiz is passed or no attempts
    are left.
  - `GET .../quiz/attempts/:id` returns one of your past attempts again, with your answers, under
    the same rule.

## Assignments

- **Shape**: points (100 by default), an optional due date, and whether a written answer, files
  or both are accepted. The instructions are the lesson's notes.
- **Handing in**:
  - Each student has one submission per assignment: a draft until handed in, then *graded* or
    *returned* for another try.
  - Files (PDF, text, images, Office and OpenDocument documents, ZIP, MP3 and MP4; up to 5 of
    25 MiB each) go straight to storage with a signed `PUT`. The signature covers the declared Content-Type, so
    nothing else can be stored under it.
  - Files count against the school's quota, as videos do: reserved when the upload starts, then
    checked for size and counted as used.
  - Uploads not finished within a day are removed by the worker's nightly clean-up.
- **Grading**: the course's editors list the handed-in work (waiting first), open a submission,
  and grade it or return it with feedback.
- **Downloads** go through presigned GETs that force `Content-Disposition: attachment` and a
  generic Content-Type, so the browser never displays a student's file. Only the student and the
  course's editors may get one.
- Deleting a lesson, course or member queues their files for deletion; the worker removes them
  and frees their space.

## Notifications

- **Where they come from**: outbox events, handled by the worker.

| Event | Who's told | Email by default |
| --- | --- | --- |
| `course.published` | Every member of the school, but the publisher | No |
| `lesson.published` | The course's enrolled students | No |
| `assignment.submitted` | The course's author; if they've left, the school's admins and owner | No |
| `assignment.graded` | The student (graded or returned) | Yes |
| `video.processed` | Whoever uploaded the video (ready or failed) | No |
| `discussion.posted` | The course's author (or the school's admins and owner), for a new thread or lesson comment | No |
| `discussion.reply` | The author of the thread or comment replied to | No |
| `discussion.reported` | The course's author (or the school's admins and owner) | Yes |
| `live.scheduled` | The course's enrolled students | No |
| `live.reminder` | The course's enrolled students and the class's host, 15 minutes before | Yes |
| `live.started` | The course's enrolled students | No |

- **Delivery**:
  - The worker writes one row per person through `app.add_notifications(...)`. Its key, from the
    outbox event, makes a retried event notify nobody twice.
  - A post quoted in a notification is cut to 140 characters of plain text, its Markdown removed.
  - It pushes each new row to the person's devices over Socket.IO (`notification:new`), through
    the Redis emitter.
  - It emails those who asked, paced by `MAIL_RATE_PER_SECOND`. Links use `PUBLIC_WEB_URL`.
- **Reading**: `GET /notifications` (newest first, a cursor per page, with the unread count),
  `POST /notifications/read` (some or all), and `GET`/`PUT /notifications/settings` for each kind,
  in the app and by email.
- Notifications are kept for 90 days.

## Insights

- `GET .../insights` gives a course's editors enrolled students, those active in the last 7
  days, those who finished, the average progress, and per lesson: started, completed, the
  average share of the video watched, quiz pass rates and attempts, and assignment grades.
- `GET .../lessons/:id/insights` gives a video's retention curve (how many students played each
  5-second stretch), or how often each quiz question is answered correctly.
- Both are computed on request, from enrolled students' rows only.

## Live classes

See [ADR 9](adr/0009-live-and-social.md).

- **A class** belongs to a course: a title, a start, a length (5 minutes to 8 hours) and where the
  video comes from. The course's editors are its hosts: they schedule, change, start, end, cancel
  or remove it. Enrolled students of the published course may join.
- **Its status** goes `scheduled` → `live` → `ended`, or `scheduled` → `cancelled`. A `CHECK`
  constraint ties `started_at` and `ended_at` to the status.
- **The video**:
  - `livekit`: `POST .../token` signs a LiveKit token for two hours, for the room `grand-{id}`.
    Hosts may publish and administer the room from before the start; students may subscribe once
    the class is live, and publish only after a host lets them speak, which the API also applies
    to their live connection through LiveKit's server API. Nobody may send data packets or change
    their own metadata, so the chat stays ours. Offered only when `LIVEKIT_*` is set
    (`GET /live/options`).
  - `youtube`: the live video's id (pasted as a link or an id), embedded on the class page.
  - `link`: an `https` meeting address, shown to students only from 10 minutes before the start.
  - Any class can have a replay afterwards, as a YouTube video id.
- **The room** (`live:{id}` on the socket):
  - Students come in from 15 minutes before the start; hosts at any time until it ends.
  - Joining returns the class, the latest messages and who's there. Attendance (first joined,
    last seen) is saved on joining and leaving.
  - Chat is stored (`live_messages`), at most 500 characters, 8 messages per 10 seconds per
    person. Hosts hide messages; others then see an empty, hidden message.
  - Raised hands and who may speak are Redis sets for the length of the class, cleared when it
    ends. Hands go up only while live.
  - Starting or ending a class is announced to the room; ending it also closes the LiveKit room.

## Discussions

- **Posts** come in three shapes, in one table: a course thread (with a title), a comment under a
  lesson, and a reply to either, one level deep. A `CHECK` constraint keeps the shapes apart.
- **Readers** are the course's editors and the students enrolled in the published course. Lesson
  comments also need the lesson to be published, unless you edit it.
- **Lists** are sorted by latest activity, newest, or most helpful, and filtered to unanswered
  questions or your own. Pinned threads come first. Pages use keyset cursors (pinned, the sort key,
  id), so new posts don't shift them.
- **Helpful votes**: one per person and post, never on your own. Counts are kept on the post.
- **Each post tells the reader** whether they found it helpful, wrote it, may moderate it, have
  reported it, and, for a thread or comment, whether it has an accepted answer.
- **Moderation**, by the course's editors:
  - Pin and lock threads (a locked thread takes no replies, except from moderators), hide posts,
    and mark the reply that answers a thread.
  - Reports: once per person and post, with a reason and a note. Hiding the post or dismissing the
    report resolves it, and hiding a post resolves all of its reports. Every decision goes in the
    audit log.
  - Hidden posts stay visible to their author and the moderators.
- **Deleting**: authors delete their own posts, moderators any. A post with replies becomes a
  `[deleted]` placeholder so the conversation still reads; one without is removed, and so is a
  deleted thread whose last reply goes.
- **Limits**: 30 posts per 10 minutes, 120 votes a minute and 20 reports an hour per person.

## Search

- `GET /schools/:slug/search?q&type&limit&offset` searches courses, lessons and discussions.
- **Indexes**: generated, stored `tsvector` columns with English stemming and GIN indexes:
  - courses: title (A), summary (B), description (C)
  - lessons: title (A), summary (B), notes (C)
  - discussion posts: title (A), body (B)
- **The query** is built from what was typed, never passed through as syntax: up to 8 words of
  letters and digits (accents removed), joined with `&`, the last one a prefix (`word:*`), so
  results come as you type. Ranking uses `ts_rank_cd`.
- **What you see**:
  - published courses, plus drafts for their editors
  - those courses' lessons, published ones (drafts for editors), marked `locked` if you can't open
    them. A locked lesson is found, ranked and quoted by its title and summary only, never its
    notes.
  - visible posts in the courses whose discussions you read
- **Snippets** come from `ts_headline`, with matches between the control characters `\u0002` and
  `\u0003`. The page splits on them (`snippetParts` in the contracts) and never renders HTML.
- The answer has every type's total, and the items of one type or all of them.

## Demo mode

The public site has no API server, so it's built with `VITE_DEMO=true` and runs the LMS against a
mock of the API inside the page (`apps/web/src/demo`):

- **One switch point**: `lib/session.js` sends every `/api/v1` request through one function, which
  in demo builds hands it to the mock instead of `fetch`. The mock answers with a real `Response`,
  so error handling, token refresh and the rest of the app don't know the difference. The socket
  and the upload of handed-in files have in-page stand-ins too.
- **The API's rules, ported**: the same checks in the same order (session, school role,
  validation with the shared zod schemas), the same access rules, quiz grading and reveal,
  watch-progress bitsets, insights, and the worker's notification rules. Each request runs like a
  transaction and is undone if it fails.
- **Data**: a seed built from `src/demo/content.js` on every visit (a school, its people and
  courses, and generated activity for about forty classmates), with times relative to now. Only
  the visitor's changes are saved, in one `localStorage` entry; "Reset demo" forgets them.
- **Video**: lessons embed YouTube lectures, except *The Physics of Sound*, whose HLS files are
  served from `public/demo/media` and played by the app's own player.
- **Live and social**: the mock has discussions, live classes and search with the API's rules.
  - Discussions are seeded for every course (`src/demo/social.js`), with answers, a locked
    thread, a deleted one kept for its replies, and reports to work through.
  - Live classes use YouTube or a meeting link. A scripted room (`src/demo/liveRooms.js`) has
    classmates who come and go, chat, raise hands and are called on, and a host who answers.
  - Seeded classes are timed from the visit: each visit gets a fresh schedule (a class live now,
    one about to start, and others), while classes the visitor scheduled or ran are kept.
  - Search ranks titles above summaries above notes, stems lightly, and treats the last word as
    a prefix, as Postgres does.
- **Nothing of it in a real build**: with the flag off, a build plugin resolves every import of
  `src/demo` to an empty module and drops `public/demo`. A test checks that `src/demo` is only ever
  imported dynamically, behind the flag, which is what lets the build drop it.

## Operations

- **Health**:
  - `GET /api/v1/health/live` checks that the process is up.
  - `GET /api/v1/health/ready` checks Postgres and Redis, each within 2 s.
- **Logs**: pino JSON in production, with pretty lines in development.
  - Authorization headers and cookies are redacted.
  - Health checks aren't logged.
- **API documentation**: the OpenAPI document at `/api/v1/openapi.json`, generated from the same
  zod schemas. It's off in production unless `OPENAPI=true`.
- **Shutdown**: SIGTERM stops new requests (503), lets running ones finish, closes the sockets,
  leaves the Redis channels, then closes the database and Redis connections.
- **Headers**:
  - The API sends a CSP of `default-src 'none'`, `X-Frame-Options: DENY` and `Cache-Control: no-store`.
  - It sends HSTS in production.
  - It accepts JSON bodies only, up to 100 KiB.

## Tests

| Suite | Runs against | Covers |
| --- | --- | --- |
| `apps/api/test/*.test.ts` | Real Postgres and Redis (`grand_test`, Redis db 15) | Row-level security, sign-up and login, refresh rotation and reuse, devices, schools, members and roles, invitations, rate limits, WebSockets, headers and errors. |
| `apps/api/src/**/*.spec.ts` | Nothing external | Configuration, cursors, address masking, the progress bitset, quiz grading. |
| `apps/api/test/courses.test.ts`, `media.test.ts` | Real Postgres, Redis and Garage | Courses, drafts and permissions, outlines, enrollments, uploads and quotas, playback tokens and rewritten playlists. |
| `apps/api/test/learning.test.ts`, `notifications.test.ts` | Real Postgres, Redis and Garage | Lesson kinds, watch progress and completion, quiz grading and attempt limits under parallel requests, assignment files and grading, insights, the notification inbox and settings. |
| `apps/api/test/live.test.ts`, `discussions.test.ts`, `search.test.ts` | Real Postgres and Redis, and a LiveKit server | Scheduling and the class lifecycle, who sees a meeting link when, the waiting room, chat and its limit, hiding, hands, attendance, LiveKit tokens and grants against a real server. Threads, comments and replies, locking, voting, moderation, reports, deletion, live updates. Stemming, prefixes, ranking, snippets and what each person may find. |
| `apps/worker/test` | Real Postgres, Redis and Garage, and ffmpeg | Relay deduplication, email and scrubbing, idempotent retries, clean-up. Transcoding landscape, portrait and silent video, refusing files that aren't video or are too long, deletion, abandoned uploads. Notification recipients, choices and emails; handed-in files' deletion. Discussion and live class notifications, reminders sent once, classes left behind closed. |
| `apps/worker/scripts/check-ffmpeg.mjs` | The worker image's ffmpeg (in CI) | The pipeline's ffmpeg commands work with the ffmpeg the image ships. |
| `apps/web/tests` | Mocks | The video proxy for lesson embeds, client logic, the demo, security rules for the page. |

Set `TEST_DATABASE_ADMIN_URL` (a superuser connection string) and `TEST_REDIS_URL`. With
`npm run infra:up`, the defaults already point at the right place. The video tests also need
`TEST_S3_ENDPOINT`, `TEST_S3_BUCKET`, `TEST_S3_ACCESS_KEY_ID` and `TEST_S3_SECRET_ACCESS_KEY`
(Garage from `infra:up`, after `npm run storage:setup`), and ffmpeg for the worker. The LiveKit
test needs `TEST_LIVEKIT_URL`, `TEST_LIVEKIT_API_KEY` and `TEST_LIVEKIT_API_SECRET` (LiveKit from
`infra:up` uses `devkey` and `secret`). Without them those tests are skipped.
