-- Grand LMS foundation: people, schools, memberships, sign-in sessions, invitations, the outbox
-- and the audit log.
--
-- Migrations run as the database owner. The API and the worker connect as grand_app, which owns
-- nothing, so row-level security always applies to them and they can only do what is granted here.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'grand_app') THEN
    -- Deployments create it with a password first (infra/postgres/init); this keeps a bare
    -- database migratable.
    CREATE ROLE grand_app NOLOGIN;
  END IF;
END
$$;

CREATE SCHEMA app;
REVOKE ALL ON SCHEMA app FROM PUBLIC;
GRANT USAGE ON SCHEMA app TO grand_app;

-- The school and person a transaction acts for. The API sets both with set_config(..., true) at
-- the start of every transaction, so they end with it and never leak between pooled connections.
CREATE FUNCTION app.current_school_id() RETURNS uuid
LANGUAGE sql STABLE PARALLEL SAFE
AS $$ SELECT nullif(current_setting('app.school_id', true), '')::uuid $$;

CREATE FUNCTION app.current_user_id() RETURNS uuid
LANGUAGE sql STABLE PARALLEL SAFE
AS $$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;

CREATE FUNCTION app.touch_updated_at() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$$;

CREATE TYPE member_role AS ENUM ('owner', 'admin', 'instructor', 'student');

-- People -----------------------------------------------------------------------------------------

CREATE TABLE users (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email             text NOT NULL,
  name              text NOT NULL,
  password_hash     text NOT NULL,
  email_verified_at timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_email_normalized CHECK (email = lower(btrim(email)) AND char_length(email) <= 254),
  CONSTRAINT users_name_length CHECK (char_length(name) BETWEEN 1 AND 80)
);
CREATE UNIQUE INDEX users_email_key ON users (email);
CREATE TRIGGER users_touch BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

-- Schools (tenants) ------------------------------------------------------------------------------

CREATE TABLE schools (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug       text NOT NULL,
  name       text NOT NULL,
  created_by uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT schools_slug_format CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length(slug) BETWEEN 3 AND 40),
  CONSTRAINT schools_name_length CHECK (char_length(name) BETWEEN 2 AND 80)
);
CREATE UNIQUE INDEX schools_slug_key ON schools (slug);
CREATE INDEX schools_created_by_idx ON schools (created_by);
CREATE TRIGGER schools_touch BEFORE UPDATE ON schools FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

CREATE TABLE memberships (
  school_id  uuid NOT NULL REFERENCES schools (id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role       member_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (school_id, user_id)
);
CREATE INDEX memberships_user_idx ON memberships (user_id);
-- Keyset pagination of a school's members, oldest first.
CREATE INDEX memberships_school_order_idx ON memberships (school_id, created_at, user_id);
-- Every school has exactly one owner.
CREATE UNIQUE INDEX memberships_one_owner_key ON memberships (school_id) WHERE role = 'owner';
CREATE TRIGGER memberships_touch BEFORE UPDATE ON memberships FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

-- Sign-in ----------------------------------------------------------------------------------------

-- One row per signed-in device. Its refresh tokens rotate on every use; presenting a used one
-- again means the token was copied, and the whole session is revoked.
CREATE TABLE sessions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  user_agent     text CHECK (char_length(user_agent) <= 512),
  ip             inet,
  created_at     timestamptz NOT NULL DEFAULT now(),
  last_used_at   timestamptz NOT NULL DEFAULT now(),
  expires_at     timestamptz NOT NULL,
  revoked_at     timestamptz,
  revoked_reason text CHECK (revoked_reason IN ('logout', 'revoked', 'reuse_detected')),
  CONSTRAINT sessions_revocation CHECK ((revoked_at IS NULL) = (revoked_reason IS NULL))
);
CREATE INDEX sessions_active_user_idx ON sessions (user_id, last_used_at DESC) WHERE revoked_at IS NULL;

CREATE TABLE refresh_tokens (
  token_hash bytea PRIMARY KEY CHECK (octet_length(token_hash) = 32),
  session_id uuid NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at    timestamptz
);
CREATE INDEX refresh_tokens_session_idx ON refresh_tokens (session_id);

-- Invitations ------------------------------------------------------------------------------------

CREATE TABLE invitations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id   uuid NOT NULL REFERENCES schools (id) ON DELETE CASCADE,
  email       text NOT NULL CHECK (email = lower(btrim(email))),
  role        member_role NOT NULL CHECK (role <> 'owner'),
  token_hash  bytea NOT NULL CHECK (octet_length(token_hash) = 32),
  invited_by  uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  accepted_at timestamptz,
  accepted_by uuid REFERENCES users (id) ON DELETE SET NULL,
  revoked_at  timestamptz
);
CREATE UNIQUE INDEX invitations_token_key ON invitations (token_hash);
-- At most one open invitation per address and school; inviting again replaces it.
CREATE UNIQUE INDEX invitations_open_key ON invitations (school_id, email) WHERE accepted_at IS NULL AND revoked_at IS NULL;
CREATE INDEX invitations_school_order_idx ON invitations (school_id, created_at DESC);

-- Someone holding an invitation link doesn't act for any school yet, so row-level security would
-- hide the row. This returns exactly the one invitation the token's hash names, and nothing else.
CREATE FUNCTION app.invitation_by_token(p_token_hash bytea)
RETURNS TABLE (
  id uuid, school_id uuid, email text, role member_role, invited_by uuid,
  expires_at timestamptz, accepted_at timestamptz, revoked_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT id, school_id, email, role, invited_by, expires_at, accepted_at, revoked_at
  FROM invitations
  WHERE token_hash = p_token_hash
$$;

-- Outbox -----------------------------------------------------------------------------------------

-- Events written in the same transaction as the change they describe, so none is lost or sent for
-- a change that rolled back. The worker moves them to its job queue.
CREATE TABLE outbox (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  type         text NOT NULL CHECK (type ~ '^[a-z]+(\.[a-z_]+)+$'),
  school_id    uuid REFERENCES schools (id) ON DELETE CASCADE,
  payload      jsonb NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  processed_at timestamptz,
  attempts     integer NOT NULL DEFAULT 0,
  last_error   text
);
CREATE INDEX outbox_unpublished_idx ON outbox (id) WHERE published_at IS NULL;

-- Wakes the worker the moment an event commits (NOTIFY is delivered on commit only).
CREATE FUNCTION app.notify_outbox() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM pg_notify('outbox', NEW.id::text);
  RETURN NULL;
END
$$;
CREATE TRIGGER outbox_notify AFTER INSERT ON outbox FOR EACH ROW EXECUTE FUNCTION app.notify_outbox();

-- Audit log --------------------------------------------------------------------------------------

-- Append-only: grand_app may add and read entries, never change or remove them.
CREATE TABLE audit_log (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id   uuid REFERENCES schools (id) ON DELETE CASCADE,
  actor_id    uuid REFERENCES users (id) ON DELETE SET NULL,
  action      text NOT NULL CHECK (action ~ '^[a-z]+(\.[a-z_]+)+$'),
  target_type text,
  target_id   text,
  ip          inet,
  data        jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_school_idx ON audit_log (school_id, id DESC);
CREATE INDEX audit_log_actor_idx ON audit_log (actor_id, id DESC);

-- Row-level security -----------------------------------------------------------------------------

-- Anyone may read a school's public details (its address and name) and create one for themselves;
-- only a transaction acting for the school may change it.
ALTER TABLE schools ENABLE ROW LEVEL SECURITY;
CREATE POLICY schools_read ON schools FOR SELECT TO grand_app USING (true);
CREATE POLICY schools_create ON schools FOR INSERT TO grand_app WITH CHECK (created_by = app.current_user_id());
CREATE POLICY schools_update ON schools FOR UPDATE TO grand_app
  USING (id = app.current_school_id()) WITH CHECK (id = app.current_school_id());

-- A school's memberships are visible and changeable only while acting for that school. A person
-- may also read their own memberships in every school (their list of schools).
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
CREATE POLICY memberships_school ON memberships TO grand_app
  USING (school_id = app.current_school_id()) WITH CHECK (school_id = app.current_school_id());
CREATE POLICY memberships_own ON memberships FOR SELECT TO grand_app USING (user_id = app.current_user_id());

ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;
CREATE POLICY invitations_school ON invitations TO grand_app
  USING (school_id = app.current_school_id()) WITH CHECK (school_id = app.current_school_id());

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_log_write ON audit_log FOR INSERT TO grand_app
  WITH CHECK (school_id IS NULL OR school_id = app.current_school_id());
CREATE POLICY audit_log_read ON audit_log FOR SELECT TO grand_app USING (school_id = app.current_school_id());

-- Privileges -------------------------------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE ON users, schools, invitations TO grand_app;
-- DELETE on sessions, refresh tokens and the outbox is for the worker's clean-up of expired rows.
GRANT SELECT, INSERT, UPDATE, DELETE ON memberships, sessions, refresh_tokens, outbox TO grand_app;
GRANT SELECT, INSERT ON audit_log TO grand_app;

REVOKE ALL ON FUNCTION app.invitation_by_token(bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.current_school_id(), app.current_user_id(), app.invitation_by_token(bytea) TO grand_app;
