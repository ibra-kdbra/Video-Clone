# Roadmap

Grand LMS grows in phases. Each phase ships working software with tests and documentation, and
stays within free tiers.

## Phase 0: foundation (this release)

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

## Phase 1: courses and video

- Courses, modules and lessons, with drafts and publishing. Instructors write; students read what
  is published.
- **Video lessons**:
  - Uploads go straight from the browser to Cloudflare R2 (presigned multipart), with a storage
    quota per school.
  - The worker transcodes them to HLS (several qualities) with ffmpeg, and makes thumbnails and a
    storyboard.
  - Playback is adaptive (hls.js), through short-lived signed URLs.
- Lessons can also use a YouTube, Dailymotion or Twitch video, through the existing proxy.
- Enrollments, and a course catalog per school at `/s/{school}`.

## Phase 2: learning progress

- Watch progress: which 5-second stretches were actually watched, saved as a bitset. Resume where
  you left off; a lesson completes at a threshold.
- Quizzes (multiple choice, short answer), graded on the server, with attempts and scores.
- Assignments with file submissions and feedback.
- Notifications in the app, live over the socket and by email, with preferences.
- Instructor dashboards: completion, drop-off points in each video, quiz results.

## Phase 3: live and social

- Live classes: scheduling, a waiting room and live chat over the existing socket rooms. Video is
  either an embedded YouTube Live stream or self-hosted WebRTC (LiveKit) when a server allows it.
- Lesson comments and course discussions, with moderation.
- Full-text search across a school's courses (Postgres `tsvector`).

## Later

- Email verification and password reset (both reuse the outbox and email path).
- Sign-in with Google or GitHub.
- School branding (logo and colors) and custom domains.
- Exports: grades as CSV, and certificates as PDF.
