-- Learning progress: what each person watched and finished, quizzes and their attempts,
-- assignments and their submissions, and notifications.
--
-- As in 0002, every school-scoped row carries school_id, and composite foreign keys pin rows to the
-- lesson, course and school they belong to.

-- Lesson kinds ------------------------------------------------------------------------------------

-- A lesson is watched and read; a quiz is answered; an assignment is handed in. Quizzes and
-- assignments keep their instructions in the lesson's notes and have no video of their own.
CREATE TYPE lesson_kind AS ENUM ('lesson', 'quiz', 'assignment');
ALTER TABLE lessons ADD COLUMN kind lesson_kind NOT NULL DEFAULT 'lesson';
ALTER TABLE lessons ADD CONSTRAINT lessons_kind_video CHECK (kind = 'lesson' OR video_provider IS NULL);
-- What the tables below point at, so a row can't name a lesson of another course or school.
ALTER TABLE lessons ADD CONSTRAINT lessons_identity UNIQUE (id, course_id, school_id);

-- Progress ----------------------------------------------------------------------------------------

-- One row per person and lesson they started. `watched` has one bit per 5-second stretch of the
-- video (most significant bit first), set once that stretch has played, so skipping ahead doesn't
-- count as watching and rewatching doesn't count twice. A lesson is completed once, and stays so.
-- Progress belongs to the school membership: it survives leaving and rejoining a course.
CREATE TABLE lesson_progress (
  school_id        uuid NOT NULL,
  course_id        uuid NOT NULL,
  lesson_id        uuid NOT NULL,
  user_id          uuid NOT NULL,
  watched          bytea NOT NULL DEFAULT '\x' CHECK (octet_length(watched) <= 2700),
  watched_seconds  integer NOT NULL DEFAULT 0 CHECK (watched_seconds >= 0),
  position_seconds integer NOT NULL DEFAULT 0 CHECK (position_seconds >= 0),
  completed_at     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (lesson_id, user_id),
  FOREIGN KEY (lesson_id, course_id, school_id) REFERENCES lessons (id, course_id, school_id) ON DELETE CASCADE,
  FOREIGN KEY (school_id, user_id) REFERENCES memberships (school_id, user_id) ON DELETE CASCADE
);
CREATE INDEX lesson_progress_course_user_idx ON lesson_progress (course_id, user_id, updated_at DESC);
CREATE INDEX lesson_progress_user_idx ON lesson_progress (user_id, updated_at DESC);
CREATE TRIGGER lesson_progress_touch BEFORE UPDATE ON lesson_progress FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

-- Quizzes -----------------------------------------------------------------------------------------

-- A quiz lesson's settings and questions. The questions are one document, written and replaced as a
-- whole by the course's editors and validated by the API:
--   [{ id, kind: single | multiple | short, prompt, explanation, points,
--      options: [{ id, label, correct }], answers: [accepted short answers] }]
CREATE TABLE quizzes (
  lesson_id    uuid PRIMARY KEY,
  school_id    uuid NOT NULL,
  course_id    uuid NOT NULL,
  pass_percent smallint NOT NULL DEFAULT 70 CHECK (pass_percent BETWEEN 0 AND 100),
  max_attempts smallint CHECK (max_attempts BETWEEN 1 AND 100),
  questions    jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(questions) = 'array'),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (lesson_id, course_id, school_id) REFERENCES lessons (id, course_id, school_id) ON DELETE CASCADE
);
CREATE TRIGGER quizzes_touch BEFORE UPDATE ON quizzes FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

-- Every attempt, graded by the API when it's handed in. `results` keeps how each question was
-- marked at the time, so later edits to the quiz don't rewrite past scores.
CREATE TABLE quiz_attempts (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id  uuid NOT NULL,
  course_id  uuid NOT NULL,
  lesson_id  uuid NOT NULL,
  user_id    uuid NOT NULL,
  answers    jsonb NOT NULL,
  results    jsonb NOT NULL,
  score      numeric(8, 2) NOT NULL CHECK (score >= 0),
  max_score  numeric(8, 2) NOT NULL CHECK (max_score >= 0),
  percent    smallint NOT NULL CHECK (percent BETWEEN 0 AND 100),
  passed     boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (lesson_id, course_id, school_id) REFERENCES lessons (id, course_id, school_id) ON DELETE CASCADE,
  FOREIGN KEY (school_id, user_id) REFERENCES memberships (school_id, user_id) ON DELETE CASCADE
);
CREATE INDEX quiz_attempts_lesson_user_idx ON quiz_attempts (lesson_id, user_id, created_at DESC);

-- Assignments -------------------------------------------------------------------------------------

CREATE TABLE assignments (
  lesson_id   uuid PRIMARY KEY,
  school_id   uuid NOT NULL,
  course_id   uuid NOT NULL,
  max_points  smallint NOT NULL DEFAULT 100 CHECK (max_points BETWEEN 1 AND 1000),
  allow_text  boolean NOT NULL DEFAULT true,
  allow_files boolean NOT NULL DEFAULT true,
  due_at      timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT assignments_something_to_hand_in CHECK (allow_text OR allow_files),
  FOREIGN KEY (lesson_id, course_id, school_id) REFERENCES lessons (id, course_id, school_id) ON DELETE CASCADE
);
CREATE TRIGGER assignments_touch BEFORE UPDATE ON assignments FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

-- One submission per student and assignment: a draft until handed in, then graded, or returned
-- for another try (which makes it editable again).
CREATE TYPE submission_status AS ENUM ('draft', 'submitted', 'graded', 'returned');
CREATE TABLE assignment_submissions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id    uuid NOT NULL,
  course_id    uuid NOT NULL,
  lesson_id    uuid NOT NULL,
  user_id      uuid NOT NULL,
  status       submission_status NOT NULL DEFAULT 'draft',
  body         text NOT NULL DEFAULT '' CHECK (char_length(body) <= 20000),
  grade        numeric(7, 2) CHECK (grade >= 0),
  feedback     text NOT NULL DEFAULT '' CHECK (char_length(feedback) <= 10000),
  graded_by    uuid REFERENCES users (id) ON DELETE SET NULL,
  submitted_at timestamptz,
  graded_at    timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (lesson_id, user_id),
  UNIQUE (id, school_id),
  CONSTRAINT submissions_graded_shape CHECK (status <> 'graded' OR (grade IS NOT NULL AND graded_at IS NOT NULL)),
  FOREIGN KEY (lesson_id, course_id, school_id) REFERENCES lessons (id, course_id, school_id) ON DELETE CASCADE,
  FOREIGN KEY (school_id, user_id) REFERENCES memberships (school_id, user_id) ON DELETE CASCADE
);
CREATE INDEX assignment_submissions_lesson_idx ON assignment_submissions (lesson_id, status, submitted_at);
CREATE TRIGGER assignment_submissions_touch BEFORE UPDATE ON assignment_submissions FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

-- Files handed in with a submission, uploaded straight to storage under
-- schools/{school_id}/submissions/{submission_id}/{id}. They count against the school's quota:
-- reserved while uploading, used once there.
CREATE TABLE submission_files (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id     uuid NOT NULL,
  submission_id uuid NOT NULL,
  file_name     text NOT NULL CHECK (char_length(file_name) BETWEEN 1 AND 200),
  content_type  text NOT NULL,
  size_bytes    bigint NOT NULL CHECK (size_bytes > 0),
  uploaded      boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (submission_id, school_id) REFERENCES assignment_submissions (id, school_id) ON DELETE CASCADE
);
CREATE INDEX submission_files_submission_idx ON submission_files (submission_id, created_at);
CREATE INDEX submission_files_pending_idx ON submission_files (created_at) WHERE NOT uploaded;

-- Notifications -----------------------------------------------------------------------------------

-- What each person is told about, across their schools. The worker writes them from outbox events
-- through app.add_notifications; `dedupe_key` names the event, so a retried event notifies once.
CREATE TABLE notifications (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL,
  school_id  uuid NOT NULL,
  type       text NOT NULL CHECK (type ~ '^[a-z]+(\.[a-z_]+)+$'),
  data       jsonb NOT NULL DEFAULT '{}',
  dedupe_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at    timestamptz,
  UNIQUE (user_id, dedupe_key),
  FOREIGN KEY (school_id, user_id) REFERENCES memberships (school_id, user_id) ON DELETE CASCADE
);
CREATE INDEX notifications_user_idx ON notifications (user_id, created_at DESC, id DESC);
CREATE INDEX notifications_unread_idx ON notifications (user_id) WHERE read_at IS NULL;

-- Which notifications a person wants, in the app and by email: { "<type>": { "inApp": bool,
-- "email": bool } }. Types left out use the defaults in the code.
ALTER TABLE users ADD COLUMN notification_settings jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(notification_settings) = 'object');

-- Writes one notification for each of these people, for the school the transaction acts for (the
-- foreign key to memberships keeps it to that school's members), skipping any already written for
-- this event. SECURITY DEFINER because the writer can't read other people's notifications, and so
-- couldn't see what INSERT ... RETURNING gives back.
CREATE FUNCTION app.add_notifications(p_user_ids uuid[], p_type text, p_data jsonb, p_dedupe_key text)
RETURNS TABLE (id uuid, user_id uuid, created_at timestamptz)
LANGUAGE sql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  INSERT INTO notifications (user_id, school_id, type, data, dedupe_key)
  SELECT DISTINCT recipient, app.current_school_id(), p_type, p_data, p_dedupe_key
  FROM unnest(p_user_ids) AS recipient
  WHERE app.current_school_id() IS NOT NULL
  ON CONFLICT (user_id, dedupe_key) DO NOTHING
  RETURNING notifications.id, notifications.user_id, notifications.created_at
$$;

-- Clean-up ----------------------------------------------------------------------------------------

-- Like app.stale_uploads: the nightly clean-up finds work in every school while acting for none.
CREATE FUNCTION app.stale_submission_files(p_older_than interval)
RETURNS TABLE (id uuid, school_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT id, school_id FROM submission_files
  WHERE NOT uploaded AND created_at < now() - p_older_than
  ORDER BY created_at
  LIMIT 500
$$;

-- Read notifications older than the given age, and unread ones twice as old, are deleted.
CREATE FUNCTION app.prune_notifications(p_older_than interval) RETURNS integer
LANGUAGE sql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  WITH gone AS (
    DELETE FROM notifications
    WHERE (read_at IS NOT NULL AND created_at < now() - p_older_than)
       OR created_at < now() - p_older_than * 2
    RETURNING 1
  )
  SELECT count(*)::integer FROM gone
$$;

-- Row-level security -----------------------------------------------------------------------------

ALTER TABLE lesson_progress ENABLE ROW LEVEL SECURITY;
CREATE POLICY lesson_progress_school ON lesson_progress TO grand_app
  USING (school_id = app.current_school_id()) WITH CHECK (school_id = app.current_school_id());

ALTER TABLE quizzes ENABLE ROW LEVEL SECURITY;
CREATE POLICY quizzes_school ON quizzes TO grand_app
  USING (school_id = app.current_school_id()) WITH CHECK (school_id = app.current_school_id());

ALTER TABLE quiz_attempts ENABLE ROW LEVEL SECURITY;
CREATE POLICY quiz_attempts_school ON quiz_attempts TO grand_app
  USING (school_id = app.current_school_id()) WITH CHECK (school_id = app.current_school_id());

ALTER TABLE assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY assignments_school ON assignments TO grand_app
  USING (school_id = app.current_school_id()) WITH CHECK (school_id = app.current_school_id());

ALTER TABLE assignment_submissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY assignment_submissions_school ON assignment_submissions TO grand_app
  USING (school_id = app.current_school_id()) WITH CHECK (school_id = app.current_school_id());

ALTER TABLE submission_files ENABLE ROW LEVEL SECURITY;
CREATE POLICY submission_files_school ON submission_files TO grand_app
  USING (school_id = app.current_school_id()) WITH CHECK (school_id = app.current_school_id());

-- A person reads and marks their own notifications, from any school. New ones are written only
-- through app.add_notifications.
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY notifications_own ON notifications TO grand_app
  USING (user_id = app.current_user_id()) WITH CHECK (user_id = app.current_user_id());

-- Privileges -------------------------------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE, DELETE ON lesson_progress, quizzes, assignments, assignment_submissions, submission_files TO grand_app;
-- Attempts are a record: written once, never changed.
GRANT SELECT, INSERT ON quiz_attempts TO grand_app;
GRANT SELECT, UPDATE, DELETE ON notifications TO grand_app;
REVOKE ALL ON FUNCTION app.add_notifications(uuid[], text, jsonb, text), app.stale_submission_files(interval), app.prune_notifications(interval) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.add_notifications(uuid[], text, jsonb, text), app.stale_submission_files(interval), app.prune_notifications(interval) TO grand_app;
