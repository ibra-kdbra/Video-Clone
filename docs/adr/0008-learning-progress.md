# 8. Learning progress, quizzes, assignments and notifications

**Status:** accepted, 2026-10-01

## Context
Phase 2 records what students actually do: watching, finishing lessons, taking quizzes and handing
in work. It also tells people what happened through notifications, and shows a course's editors how
it's going.

Some of this decides how much the numbers can be trusted:
- "Watched" has to mean watched. Opening a video and skipping to the end doesn't count.
- A quiz's answers must not reach the browser before they're earned.
- One server has to cope with many students reporting progress every few seconds.

## Decision
- **Lesson kinds**:
  - A lesson is a *lesson* (video and notes), a *quiz* or an *assignment*. The kind is fixed when
    the lesson is created.
  - Quizzes and assignments keep their instructions in the notes, and have no video.
- **Watch progress is a bitset**:
  - One bit per 5-second stretch of the video, in `lesson_progress.watched`. A 3-hour video needs
    270 bytes.
  - The player reports which stretches actually played since its last report: time moving forward
    normally, not seeks. It also reports its position, for resuming. The API ORs the stretches into
    the bitset under a row lock.
  - A stretch counts once however often it's replayed, and skipping ahead counts nothing.
  - An uploaded video's lesson completes at 90% of its stretches. Completion is sticky.
  - Lessons whose video plays on another platform, or that have none, are marked done by hand: an
    embedded player can't tell us what was watched.
  - The same bitsets give the editors' retention curve: how many students reached each stretch.
- **Progress belongs to the school membership, not the enrollment.** Leaving a course and coming
  back keeps your progress. Leaving the school removes it.
- **Quizzes are graded on the server**:
  - The questions are one JSON document, which editors save as a whole. Question and choice ids
    survive edits, so statistics carry over.
  - Takers get the questions without the answers.
  - Each attempt is graded by the API, and its marks are stored with it. A later edit doesn't
    rewrite past scores.
  - Choice questions are all or nothing. Short answers match ignoring case, accents and spacing.
  - The right answers and explanations come back only once the quiz is passed or no attempts are
    left.
  - The attempt limit is checked under an advisory lock, so parallel requests can't slip past it.
  - Passing completes the lesson.
- **Assignments**:
  - One submission per student: a draft until handed in, then graded or returned for another try.
  - Files go from the browser straight to storage, through a signed single PUT whose signature
    includes the Content-Type: a file can't arrive as anything other than what was declared. They
    count against the school's quota like videos: reserved while uploading, used once their size
    is checked.
  - Files are only ever downloaded through signed URLs that force `Content-Disposition:
    attachment`, so nothing a student uploads is displayed by the browser.
  - Handing in completes the lesson.
- **Notifications come from the outbox**:
  - The API records events (course published, lesson published, work handed in, graded). The worker
    works out the recipients, writes one notification per person, pushes it to their open devices
    over Socket.IO, and sends email to those who asked for it.
  - The text is written once, in the worker, so the app and the email say the same thing.
  - People choose per kind, in the app and by email. Grades default to email on; everything else is
    in the app only.
  - Notifications are read only by their owner (row-level security on `user_id`). They're written
    through a `SECURITY DEFINER` function that only writes for members of the school the
    transaction acts for. Its event key makes a retried event notify once.
- **Insights are computed on request** from the same rows, for the course's editors only. Only
  enrolled students count; editors trying things out don't.

## Consequences
- Progress reports are frequent but small: one indexed upsert of a few hundred bytes. The player
  reports every ~10 seconds, and the API allows 240 reports a minute per person.
- Retention curves are computed per request in the API. That's fine for the classes a free server
  hosts, where one video has hundreds of viewers. Much larger courses would want a nightly rollup.
- Quiz answers are typed in; there's no question bank or randomization yet.
- A notification email can be sent twice if the worker crashes between sending it and recording
  the event as done. The in-app notification is never duplicated.
