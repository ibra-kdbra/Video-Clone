-- Live and social: live classes with chat, lesson comments and course discussions with moderation,
-- and full-text search across a school's courses.
--
-- As before, every school-scoped row carries school_id, and composite foreign keys pin rows to the
-- course, lesson and school they belong to.

-- Search ------------------------------------------------------------------------------------------

-- Weighted full-text vectors that Postgres keeps up to date itself: the title counts most, then the
-- summary, then the long text. English stemming, so "vectors" finds "vector".
ALTER TABLE courses ADD COLUMN search_vector tsvector GENERATED ALWAYS AS (
  setweight(to_tsvector('english', title), 'A') ||
  setweight(to_tsvector('english', summary), 'B') ||
  setweight(to_tsvector('english', description), 'C')
) STORED;
CREATE INDEX courses_search_idx ON courses USING gin (search_vector);

ALTER TABLE lessons ADD COLUMN search_vector tsvector GENERATED ALWAYS AS (
  setweight(to_tsvector('english', title), 'A') ||
  setweight(to_tsvector('english', summary), 'B') ||
  setweight(to_tsvector('english', notes), 'C')
) STORED;
CREATE INDEX lessons_search_idx ON lessons USING gin (search_vector);

-- Live classes ------------------------------------------------------------------------------------

CREATE TYPE live_status AS ENUM ('scheduled', 'live', 'ended', 'cancelled');
-- livekit: video in the browser, through a LiveKit server the school runs; youtube: a YouTube Live
-- stream embedded in the class page; link: a meeting elsewhere (Zoom, Meet...), with the waiting
-- room and chat here.
CREATE TYPE live_provider AS ENUM ('livekit', 'youtube', 'link');

CREATE TABLE live_sessions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id        uuid NOT NULL,
  course_id        uuid NOT NULL,
  title            text NOT NULL CHECK (char_length(title) BETWEEN 2 AND 120),
  description      text NOT NULL DEFAULT '' CHECK (char_length(description) <= 5000),
  starts_at        timestamptz NOT NULL,
  duration_minutes integer NOT NULL CHECK (duration_minutes BETWEEN 5 AND 480),
  status           live_status NOT NULL DEFAULT 'scheduled',
  provider         live_provider NOT NULL,
  -- youtube: the live video's id (it can be added later, before going live); link: the meeting's
  -- address; livekit: nothing, the room is named after the session.
  stream_ref       text CHECK (char_length(stream_ref) <= 500),
  -- A replay for afterwards, as a YouTube video id.
  recording_ref    text CHECK (char_length(recording_ref) <= 20),
  started_at       timestamptz,
  ended_at         timestamptz,
  -- Set when the "starting soon" reminder goes out, so it goes once.
  reminded_at      timestamptz,
  created_by       uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, school_id),
  FOREIGN KEY (course_id, school_id) REFERENCES courses (id, school_id) ON DELETE CASCADE,
  CONSTRAINT live_sessions_ref CHECK (
    (provider = 'livekit' AND stream_ref IS NULL) OR
    (provider = 'link' AND stream_ref IS NOT NULL) OR
    provider = 'youtube'
  ),
  CONSTRAINT live_sessions_times CHECK (
    (status = 'scheduled' AND started_at IS NULL AND ended_at IS NULL) OR
    (status = 'live' AND started_at IS NOT NULL AND ended_at IS NULL) OR
    (status = 'ended' AND started_at IS NOT NULL AND ended_at IS NOT NULL) OR
    (status = 'cancelled' AND started_at IS NULL)
  )
);
CREATE INDEX live_sessions_course_idx ON live_sessions (course_id, starts_at);
CREATE INDEX live_sessions_school_idx ON live_sessions (school_id, starts_at);
CREATE INDEX live_sessions_reminder_idx ON live_sessions (starts_at) WHERE status = 'scheduled' AND reminded_at IS NULL;
CREATE TRIGGER live_sessions_touch BEFORE UPDATE ON live_sessions FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

-- The class chat. Messages stay with the session (a transcript); a host can hide one. A member who
-- leaves the school keeps their messages, unsigned.
CREATE TABLE live_messages (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id  uuid NOT NULL,
  session_id uuid NOT NULL,
  user_id    uuid,
  body       text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 500),
  hidden_at  timestamptz,
  hidden_by  uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (session_id, school_id) REFERENCES live_sessions (id, school_id) ON DELETE CASCADE,
  FOREIGN KEY (school_id, user_id) REFERENCES memberships (school_id, user_id) ON DELETE SET NULL (user_id)
);
CREATE INDEX live_messages_session_idx ON live_messages (session_id, created_at DESC, id DESC);

-- Who came to a class: first joined and last seen.
CREATE TABLE live_attendance (
  school_id    uuid NOT NULL,
  session_id   uuid NOT NULL,
  user_id      uuid NOT NULL,
  joined_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, user_id),
  FOREIGN KEY (session_id, school_id) REFERENCES live_sessions (id, school_id) ON DELETE CASCADE,
  FOREIGN KEY (school_id, user_id) REFERENCES memberships (school_id, user_id) ON DELETE CASCADE
);

-- Discussions -------------------------------------------------------------------------------------

-- One table for three shapes:
--   a course thread: no lesson, no parent, a title;
--   a lesson comment: a lesson, no parent, no title;
--   a reply: a parent (a thread or a lesson comment), no title.
-- Replies are one level deep. Posts outlive a member who leaves (author_id becomes null).
CREATE TYPE post_status AS ENUM ('visible', 'hidden', 'deleted');

CREATE TABLE discussion_posts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id        uuid NOT NULL,
  course_id        uuid NOT NULL,
  lesson_id        uuid,
  parent_id        uuid,
  author_id        uuid,
  title            text CHECK (char_length(title) BETWEEN 3 AND 150),
  body             text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 10000),
  status           post_status NOT NULL DEFAULT 'visible',
  pinned           boolean NOT NULL DEFAULT false,
  locked           boolean NOT NULL DEFAULT false,
  -- A reply the course's editors marked as the answer.
  accepted         boolean NOT NULL DEFAULT false,
  reply_count      integer NOT NULL DEFAULT 0 CHECK (reply_count >= 0),
  vote_count       integer NOT NULL DEFAULT 0 CHECK (vote_count >= 0),
  last_activity_at timestamptz NOT NULL DEFAULT now(),
  edited_at        timestamptz,
  moderated_by     uuid REFERENCES users (id) ON DELETE SET NULL,
  moderated_at     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  search_vector    tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') || setweight(to_tsvector('english', body), 'B')
  ) STORED,
  UNIQUE (id, school_id),
  UNIQUE (id, course_id, school_id),
  FOREIGN KEY (course_id, school_id) REFERENCES courses (id, school_id) ON DELETE CASCADE,
  FOREIGN KEY (lesson_id, course_id, school_id) REFERENCES lessons (id, course_id, school_id) ON DELETE CASCADE,
  FOREIGN KEY (parent_id, course_id, school_id) REFERENCES discussion_posts (id, course_id, school_id) ON DELETE CASCADE,
  FOREIGN KEY (school_id, author_id) REFERENCES memberships (school_id, user_id) ON DELETE SET NULL (author_id),
  CONSTRAINT discussion_posts_shape CHECK ((title IS NOT NULL) = (parent_id IS NULL AND lesson_id IS NULL)),
  CONSTRAINT discussion_posts_top_level_flags CHECK (parent_id IS NULL OR (NOT pinned AND NOT locked)),
  CONSTRAINT discussion_posts_answer CHECK (NOT accepted OR parent_id IS NOT NULL)
);
CREATE INDEX discussion_posts_threads_idx ON discussion_posts (course_id, lesson_id, last_activity_at DESC, id DESC) WHERE parent_id IS NULL;
CREATE INDEX discussion_posts_replies_idx ON discussion_posts (parent_id, created_at, id) WHERE parent_id IS NOT NULL;
CREATE INDEX discussion_posts_author_idx ON discussion_posts (author_id, created_at DESC);
CREATE INDEX discussion_posts_search_idx ON discussion_posts USING gin (search_vector);
CREATE TRIGGER discussion_posts_touch BEFORE UPDATE ON discussion_posts FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

-- "Helpful": one per person and post.
CREATE TABLE discussion_votes (
  school_id  uuid NOT NULL,
  post_id    uuid NOT NULL,
  user_id    uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id),
  FOREIGN KEY (post_id, school_id) REFERENCES discussion_posts (id, school_id) ON DELETE CASCADE,
  FOREIGN KEY (school_id, user_id) REFERENCES memberships (school_id, user_id) ON DELETE CASCADE
);

-- Members flag posts for the course's editors to look at. One report per person and post; a
-- report is resolved by hiding the post or dismissing the report.
CREATE TYPE report_reason AS ENUM ('spam', 'abuse', 'off_topic', 'other');

CREATE TABLE discussion_reports (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id   uuid NOT NULL,
  course_id   uuid NOT NULL,
  post_id     uuid NOT NULL,
  reporter_id uuid,
  reason      report_reason NOT NULL,
  note        text NOT NULL DEFAULT '' CHECK (char_length(note) <= 500),
  created_at  timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by uuid REFERENCES users (id) ON DELETE SET NULL,
  resolution  text CHECK (resolution IN ('hidden', 'dismissed')),
  UNIQUE (post_id, reporter_id),
  FOREIGN KEY (post_id, course_id, school_id) REFERENCES discussion_posts (id, course_id, school_id) ON DELETE CASCADE,
  FOREIGN KEY (school_id, reporter_id) REFERENCES memberships (school_id, user_id) ON DELETE SET NULL (reporter_id),
  CONSTRAINT discussion_reports_resolution CHECK ((resolved_at IS NULL) = (resolution IS NULL))
);
CREATE INDEX discussion_reports_open_idx ON discussion_reports (course_id, created_at) WHERE resolved_at IS NULL;

-- Background work ---------------------------------------------------------------------------------

-- Claims the classes starting within the window that haven't had their reminder, marking them so
-- that two workers can't both send it. The worker looks across every school, acting for none.
CREATE FUNCTION app.claim_live_reminders(p_within interval)
RETURNS TABLE (id uuid, school_id uuid)
LANGUAGE sql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  UPDATE live_sessions SET reminded_at = now()
  WHERE live_sessions.id IN (
    SELECT s.id FROM live_sessions s
    WHERE s.status = 'scheduled' AND s.reminded_at IS NULL
      AND s.starts_at > now() AND s.starts_at <= now() + p_within
    ORDER BY s.starts_at
    LIMIT 200
    FOR UPDATE SKIP LOCKED
  )
  RETURNING live_sessions.id, live_sessions.school_id
$$;

-- Ends classes left live long after they should have finished (the host closed the tab), and
-- cancels scheduled ones that never started, so schedules don't fill with ghosts.
CREATE FUNCTION app.close_stale_live(p_grace interval) RETURNS integer
LANGUAGE sql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  WITH ended AS (
    UPDATE live_sessions SET status = 'ended', ended_at = now()
    WHERE status = 'live' AND starts_at + make_interval(mins => duration_minutes) + p_grace < now()
    RETURNING 1
  ), dropped AS (
    UPDATE live_sessions SET status = 'cancelled'
    WHERE status = 'scheduled' AND starts_at + make_interval(mins => duration_minutes) + p_grace < now()
    RETURNING 1
  )
  SELECT ((SELECT count(*) FROM ended) + (SELECT count(*) FROM dropped))::integer
$$;

-- Which school a course or a class belongs to, for the live connection, which knows an id but not
-- yet which school to act for. They reveal nothing but a school id for an unguessable id; access is
-- checked afterwards, acting for that school.
CREATE FUNCTION app.course_school(p_course_id uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$ SELECT school_id FROM courses WHERE id = p_course_id $$;

CREATE FUNCTION app.live_session_school(p_session_id uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$ SELECT school_id FROM live_sessions WHERE id = p_session_id $$;

-- Row-level security -----------------------------------------------------------------------------

ALTER TABLE live_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY live_sessions_school ON live_sessions TO grand_app
  USING (school_id = app.current_school_id()) WITH CHECK (school_id = app.current_school_id());

ALTER TABLE live_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY live_messages_school ON live_messages TO grand_app
  USING (school_id = app.current_school_id()) WITH CHECK (school_id = app.current_school_id());

ALTER TABLE live_attendance ENABLE ROW LEVEL SECURITY;
CREATE POLICY live_attendance_school ON live_attendance TO grand_app
  USING (school_id = app.current_school_id()) WITH CHECK (school_id = app.current_school_id());

ALTER TABLE discussion_posts ENABLE ROW LEVEL SECURITY;
CREATE POLICY discussion_posts_school ON discussion_posts TO grand_app
  USING (school_id = app.current_school_id()) WITH CHECK (school_id = app.current_school_id());

ALTER TABLE discussion_votes ENABLE ROW LEVEL SECURITY;
CREATE POLICY discussion_votes_school ON discussion_votes TO grand_app
  USING (school_id = app.current_school_id()) WITH CHECK (school_id = app.current_school_id());

ALTER TABLE discussion_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY discussion_reports_school ON discussion_reports TO grand_app
  USING (school_id = app.current_school_id()) WITH CHECK (school_id = app.current_school_id());

-- Privileges -------------------------------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE, DELETE ON live_sessions, live_attendance, discussion_posts, discussion_votes, discussion_reports TO grand_app;
-- Chat messages are a record: written, hidden, never edited or deleted (except with their class).
GRANT SELECT, INSERT, UPDATE (hidden_at, hidden_by) ON live_messages TO grand_app;
REVOKE ALL ON FUNCTION app.claim_live_reminders(interval), app.close_stale_live(interval), app.course_school(uuid), app.live_session_school(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.claim_live_reminders(interval), app.close_stale_live(interval), app.course_school(uuid), app.live_session_school(uuid) TO grand_app;
