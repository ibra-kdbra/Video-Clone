# Roadmap

Grand LMS grows in phases. Each phase ships working software with tests and documentation, and
stays within free tiers.

## Phase 0: foundation (done)

- A monorepo (web, API, worker, shared contracts) with CI.
- Accounts:
  - Argon2id passwords and short-lived access tokens.
  - Rotating refresh tokens with reuse detection.
  - A list of signed-in devices, with remote sign-out.
- Schools as tenants, isolated by Postgres row-level security.
- Roles: owner, admin, instructor, student.
- Invitations by email, through the transactional outbox, BullMQ and SMTP.
- Real-time over Socket.IO: ticket sign-in, school rooms, presence, instant sign-out.
- Rate limits, audit log, health checks, OpenAPI, structured logs.
- Deployment on Netlify plus one Oracle Always Free server.

## Phase 1: courses and video (done)

- Courses, modules and lessons, with drafts and publishing. Owners and admins edit every course;
  instructors edit their own; students see what is published.
- An outline editor: reorder modules and lessons, and move lessons between modules, in one request.
- **Video lessons**:
  - Uploads go straight from the browser to S3-compatible storage (presigned multipart). By
    default that is Garage, on the same free server. Each school has a storage quota.
  - The worker transcodes them with ffmpeg to HLS, in every quality up to the source's (1080p to
    360p). It also makes a poster and a storyboard for scrubbing previews, and reports progress
    live.
  - Playback is adaptive (hls.js), through a signed playlist and signed storage URLs that expire.
- A lesson can use a YouTube, Dailymotion or Twitch video instead.
- Enrollments, free preview lessons, and a course catalog for each school.

## Phase 2: learning progress (done)

- Lessons come in three kinds: a lesson (video and notes), a quiz, or an assignment.
- **Watch progress**:
  - Which 5-second stretches were actually watched, saved as a bitset. Skipping ahead counts
    nothing.
  - Resume where you left off. An uploaded video's lesson completes at 90%; others are marked
    done by hand.
  - Progress through each course, "Continue learning", and per-student progress for editors.
- **Quizzes**: one answer, several answers or a short typed answer; graded on the server, with a
  pass mark, an optional attempt limit, and answers shown once they're earned.
- **Assignments**: a written answer and/or files, a due date, grading or returning with feedback.
  Files go straight to storage and count against the school's quota.
- **Notifications** in the app, live over the socket, and by email, with a choice for each kind.
- **Insights** for a course's editors: activity, completion, where students stop watching each
  video, quiz pass rates and the hardest questions, and grades.

## Phase 3: live and social (this release)

- **Live classes**, scheduled for a course by its editors:
  - Video from self-hosted LiveKit (WebRTC in the browser: camera, microphone, screen), a YouTube
    Live stream, or a meeting link.
  - A waiting room from 15 minutes before, chat over the existing socket connection, raised
    hands, letting students speak, hidden messages, attendance, and a replay afterwards.
  - Notifications when a class is scheduled, 15 minutes before, and when it starts.
- **Discussions**: comments under lessons and a board for each course, with replies, helpful
  votes, answers, live updates, and moderation (pin, lock, hide, reports).
- **Search** across a school's courses, lessons and discussions (Postgres `tsvector`, GIN indexes,
  English stemming), as you type, limited to what each person may see.
- The demo school has all of it: classes to join with scripted classmates, discussions to
  moderate, and search.

## Later

- Email verification and password reset (both reuse the outbox and email path).
- Sign-in with Google or GitHub.
- School branding (logo and colors) and custom domains.
- Exports: grades as CSV, and certificates as PDF.
