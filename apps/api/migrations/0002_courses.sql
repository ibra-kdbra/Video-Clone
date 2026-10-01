-- Courses, made of modules and lessons; uploaded videos (media assets); enrollments; and each
-- school's storage quota.
--
-- Every table carries school_id. Composite foreign keys tie a lesson to a module of the same
-- course, and a course, module, lesson, video or enrollment to the same school, so even a buggy
-- query can't link one school's rows to another's.

CREATE TYPE course_status AS ENUM ('draft', 'published', 'archived');
CREATE TYPE lesson_status AS ENUM ('draft', 'published');
CREATE TYPE media_status AS ENUM ('uploading', 'processing', 'ready', 'failed');
CREATE TYPE video_provider AS ENUM ('upload', 'youtube', 'dailymotion', 'twitch');

-- Storage quota -------------------------------------------------------------------------------------

-- What a school may store, and what it uses. `reserved_bytes` holds the declared size of uploads in
-- progress, so two uploads can't both squeeze into the last free gigabyte.
CREATE TABLE school_storage (
  school_id      uuid PRIMARY KEY REFERENCES schools (id) ON DELETE CASCADE,
  quota_bytes    bigint NOT NULL DEFAULT 2147483648 CHECK (quota_bytes >= 0),
  used_bytes     bigint NOT NULL DEFAULT 0 CHECK (used_bytes >= 0),
  reserved_bytes bigint NOT NULL DEFAULT 0 CHECK (reserved_bytes >= 0),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER school_storage_touch BEFORE UPDATE ON school_storage FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

INSERT INTO school_storage (school_id) SELECT id FROM schools;

-- Every new school gets its quota row. SECURITY DEFINER, because the transaction creating a school
-- doesn't act for it yet, so row-level security would refuse the insert.
CREATE FUNCTION app.create_school_storage() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  INSERT INTO school_storage (school_id) VALUES (NEW.id);
  RETURN NULL;
END
$$;
CREATE TRIGGER schools_create_storage AFTER INSERT ON schools FOR EACH ROW EXECUTE FUNCTION app.create_school_storage();

-- Videos ------------------------------------------------------------------------------------------

-- One uploaded video: the original while it uploads and transcodes, then its HLS renditions,
-- poster and storyboard. Object keys live under schools/{school_id}/media/{id}/.
CREATE TABLE media_assets (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id        uuid NOT NULL REFERENCES schools (id) ON DELETE CASCADE,
  uploaded_by      uuid REFERENCES users (id) ON DELETE SET NULL,
  status           media_status NOT NULL DEFAULT 'uploading',
  file_name        text NOT NULL CHECK (char_length(file_name) BETWEEN 1 AND 200),
  content_type     text NOT NULL,
  declared_bytes   bigint NOT NULL CHECK (declared_bytes > 0),
  upload_id        text,
  original_bytes   bigint,
  stored_bytes     bigint NOT NULL DEFAULT 0 CHECK (stored_bytes >= 0),
  duration_seconds numeric(10, 3),
  width            integer,
  height           integer,
  renditions       jsonb NOT NULL DEFAULT '[]',
  has_storyboard   boolean NOT NULL DEFAULT false,
  progress         smallint NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  error            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  ready_at         timestamptz,
  UNIQUE (id, school_id)
);
CREATE INDEX media_assets_school_idx ON media_assets (school_id, created_at DESC);
-- The nightly clean-up looks for uploads that were never finished.
CREATE INDEX media_assets_uploading_idx ON media_assets (created_at) WHERE status = 'uploading';
CREATE TRIGGER media_assets_touch BEFORE UPDATE ON media_assets FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

-- Courses -----------------------------------------------------------------------------------------

CREATE TABLE courses (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id      uuid NOT NULL REFERENCES schools (id) ON DELETE CASCADE,
  slug           text NOT NULL,
  title          text NOT NULL,
  summary        text NOT NULL DEFAULT '',
  description    text NOT NULL DEFAULT '',
  status         course_status NOT NULL DEFAULT 'draft',
  cover_media_id uuid,
  created_by     uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  published_at   timestamptz,
  UNIQUE (id, school_id),
  CONSTRAINT courses_slug_format CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length(slug) BETWEEN 3 AND 60),
  CONSTRAINT courses_title_length CHECK (char_length(title) BETWEEN 2 AND 120),
  CONSTRAINT courses_summary_length CHECK (char_length(summary) <= 300),
  CONSTRAINT courses_description_length CHECK (char_length(description) <= 20000),
  -- Only the cover's own column is cleared when its video goes away (PostgreSQL 15+).
  FOREIGN KEY (cover_media_id, school_id) REFERENCES media_assets (id, school_id) ON DELETE SET NULL (cover_media_id)
);
CREATE UNIQUE INDEX courses_slug_key ON courses (school_id, slug);
CREATE INDEX courses_catalog_idx ON courses (school_id, status, created_at DESC);
CREATE TRIGGER courses_touch BEFORE UPDATE ON courses FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

CREATE TABLE course_modules (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id  uuid NOT NULL,
  course_id  uuid NOT NULL,
  title      text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  position   integer NOT NULL CHECK (position >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, course_id),
  FOREIGN KEY (course_id, school_id) REFERENCES courses (id, school_id) ON DELETE CASCADE,
  -- Deferred, so a reorder can swap positions inside one transaction.
  CONSTRAINT course_modules_position_key UNIQUE (course_id, position) DEFERRABLE INITIALLY DEFERRED
);
CREATE TRIGGER course_modules_touch BEFORE UPDATE ON course_modules FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

CREATE TABLE lessons (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id        uuid NOT NULL,
  course_id        uuid NOT NULL,
  module_id        uuid NOT NULL,
  title            text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  summary          text NOT NULL DEFAULT '' CHECK (char_length(summary) <= 300),
  notes            text NOT NULL DEFAULT '' CHECK (char_length(notes) <= 50000),
  status           lesson_status NOT NULL DEFAULT 'draft',
  -- Members who aren't enrolled may watch a preview lesson, to decide whether to enroll.
  is_preview       boolean NOT NULL DEFAULT false,
  video_provider   video_provider,
  video_ref        text CHECK (char_length(video_ref) <= 100),
  media_id         uuid,
  duration_seconds integer CHECK (duration_seconds >= 0),
  position         integer NOT NULL CHECK (position >= 0),
  created_by       uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  published_at     timestamptz,
  FOREIGN KEY (course_id, school_id) REFERENCES courses (id, school_id) ON DELETE CASCADE,
  FOREIGN KEY (module_id, course_id) REFERENCES course_modules (id, course_id) ON DELETE CASCADE,
  -- A lesson's video can't be deleted out from under it; detach it first.
  FOREIGN KEY (media_id, school_id) REFERENCES media_assets (id, school_id) ON DELETE RESTRICT,
  CONSTRAINT lessons_position_key UNIQUE (module_id, position) DEFERRABLE INITIALLY DEFERRED,
  -- A lesson has no video, an uploaded one, or one on a video platform.
  CONSTRAINT lessons_video_shape CHECK (
    (video_provider IS NULL AND video_ref IS NULL AND media_id IS NULL)
    OR (video_provider = 'upload' AND media_id IS NOT NULL AND video_ref IS NULL)
    OR (video_provider IN ('youtube', 'dailymotion', 'twitch') AND video_ref IS NOT NULL AND media_id IS NULL)
  )
);
CREATE INDEX lessons_course_idx ON lessons (course_id);
CREATE UNIQUE INDEX lessons_media_key ON lessons (media_id) WHERE media_id IS NOT NULL;
CREATE TRIGGER lessons_touch BEFORE UPDATE ON lessons FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

-- Enrollments -------------------------------------------------------------------------------------

-- Only a school's members can enroll in its courses, and leaving the school ends their enrollments
-- (the foreign key to memberships cascades).
CREATE TABLE enrollments (
  school_id  uuid NOT NULL,
  course_id  uuid NOT NULL,
  user_id    uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (course_id, user_id),
  FOREIGN KEY (course_id, school_id) REFERENCES courses (id, school_id) ON DELETE CASCADE,
  FOREIGN KEY (school_id, user_id) REFERENCES memberships (school_id, user_id) ON DELETE CASCADE
);
CREATE INDEX enrollments_user_idx ON enrollments (user_id, created_at DESC);
CREATE INDEX enrollments_course_order_idx ON enrollments (course_id, created_at, user_id);

-- The nightly clean-up must find uploads abandoned in any school, while acting for none. This
-- returns only their ids; everything else is done per school, under row-level security.
CREATE FUNCTION app.stale_uploads(p_older_than interval)
RETURNS TABLE (id uuid, school_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT id, school_id FROM media_assets
  WHERE status = 'uploading' AND created_at < now() - p_older_than
  ORDER BY created_at
  LIMIT 500
$$;

-- Row-level security -----------------------------------------------------------------------------

ALTER TABLE school_storage ENABLE ROW LEVEL SECURITY;
CREATE POLICY school_storage_school ON school_storage TO grand_app
  USING (school_id = app.current_school_id()) WITH CHECK (school_id = app.current_school_id());

ALTER TABLE media_assets ENABLE ROW LEVEL SECURITY;
CREATE POLICY media_assets_school ON media_assets TO grand_app
  USING (school_id = app.current_school_id()) WITH CHECK (school_id = app.current_school_id());

ALTER TABLE courses ENABLE ROW LEVEL SECURITY;
CREATE POLICY courses_school ON courses TO grand_app
  USING (school_id = app.current_school_id()) WITH CHECK (school_id = app.current_school_id());

ALTER TABLE course_modules ENABLE ROW LEVEL SECURITY;
CREATE POLICY course_modules_school ON course_modules TO grand_app
  USING (school_id = app.current_school_id()) WITH CHECK (school_id = app.current_school_id());

ALTER TABLE lessons ENABLE ROW LEVEL SECURITY;
CREATE POLICY lessons_school ON lessons TO grand_app
  USING (school_id = app.current_school_id()) WITH CHECK (school_id = app.current_school_id());

-- A person may also read their own enrollments in every school ("my courses").
ALTER TABLE enrollments ENABLE ROW LEVEL SECURITY;
CREATE POLICY enrollments_school ON enrollments TO grand_app
  USING (school_id = app.current_school_id()) WITH CHECK (school_id = app.current_school_id());
CREATE POLICY enrollments_own ON enrollments FOR SELECT TO grand_app USING (user_id = app.current_user_id());

-- Privileges -------------------------------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE, DELETE ON courses, course_modules, lessons, media_assets, enrollments TO grand_app;
-- Quota rows are created by the trigger above and removed with their school.
GRANT SELECT, UPDATE ON school_storage TO grand_app;
REVOKE ALL ON FUNCTION app.create_school_storage(), app.stale_uploads(interval) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.stale_uploads(interval) TO grand_app;
