-- 001_identity.sql
-- Identity, access and session tables (design §4, §18).
-- All business rows carry class_id, UUID primary keys and timestamptz.

CREATE TABLE classes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  gateway_passcode_hash text NOT NULL,
  gateway_passcode_version integer NOT NULL DEFAULT 1 CHECK (gateway_passcode_version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  is_active boolean NOT NULL DEFAULT true,
  temporary_idle_minutes integer NOT NULL DEFAULT 10
    CHECK (temporary_idle_minutes BETWEEN 1 AND 120),
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE class_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  student_number text CHECK (student_number IS NULL OR char_length(student_number) <= 30),
  real_name text NOT NULL CHECK (char_length(real_name) BETWEEN 1 AND 30),
  real_name_pinyin text NOT NULL DEFAULT '' CHECK (char_length(real_name_pinyin) <= 120),
  gender text NOT NULL CHECK (char_length(gender) BETWEEN 1 AND 20),
  hidden boolean NOT NULL DEFAULT false,
  muted_until timestamptz,
  presence_status text NOT NULL DEFAULT 'offline'
    CHECK (presence_status IN ('focus', 'resting', 'offline')),
  presence_updated_at timestamptz,
  joined_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (class_id, user_id)
);

CREATE UNIQUE INDEX class_members_student_number_unique
  ON class_members (class_id, student_number)
  WHERE student_number IS NOT NULL AND student_number <> '';

CREATE INDEX class_members_class_visible_idx
  ON class_members (class_id, hidden, joined_at);

CREATE TABLE profiles (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  class_id uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  nickname text NOT NULL CHECK (char_length(nickname) BETWEEN 1 AND 12 AND nickname !~ '[\r\n]'),
  nickname_norm text NOT NULL CHECK (char_length(nickname_norm) BETWEEN 1 AND 12),
  nickname_pinyin text NOT NULL DEFAULT '' CHECK (char_length(nickname_pinyin) <= 120),
  birthday_enc jsonb,
  birthday_visible boolean NOT NULL DEFAULT true,
  signature text NOT NULL DEFAULT '' CHECK (char_length(signature) <= 30),
  introduction text NOT NULL DEFAULT '' CHECK (char_length(introduction) <= 200),
  avatar_object_key text CHECK (avatar_object_key IS NULL OR char_length(avatar_object_key) <= 512),
  background_object_key text CHECK (background_object_key IS NULL OR char_length(background_object_key) <= 512),
  like_count integer NOT NULL DEFAULT 0 CHECK (like_count >= 0),
  following_count integer NOT NULL DEFAULT 0 CHECK (following_count >= 0),
  follower_count integer NOT NULL DEFAULT 0 CHECK (follower_count >= 0),
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (class_id, nickname_norm)
);

CREATE INDEX profiles_plaza_idx
  ON profiles (class_id, like_count DESC, user_id);
CREATE INDEX profiles_nickname_pinyin_idx
  ON profiles (class_id, nickname_pinyin);

CREATE TABLE password_credentials (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  password_hash text NOT NULL,
  password_length integer NOT NULL CHECK (password_length BETWEEN 1 AND 256),
  match_tag text NOT NULL,
  match_tag_version integer NOT NULL DEFAULT 1 CHECK (match_tag_version >= 1),
  must_change boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id text NOT NULL CHECK (char_length(device_id) BETWEEN 16 AND 128),
  device_name text NOT NULL CHECK (char_length(device_name) BETWEEN 1 AND 80),
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (class_id, user_id, device_id)
);

CREATE INDEX devices_user_idx ON devices (user_id, last_seen_at DESC);

CREATE TABLE session_families (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id text NOT NULL CHECK (char_length(device_id) BETWEEN 16 AND 128),
  mode text NOT NULL CHECK (mode IN ('temporary', 'persistent')),
  absolute_expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  revoked_reason text CHECK (revoked_reason IS NULL OR char_length(revoked_reason) <= 120),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX session_families_user_idx ON session_families (user_id, created_at DESC);
CREATE INDEX session_families_active_idx ON session_families (user_id) WHERE revoked_at IS NULL;

CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL REFERENCES session_families(id) ON DELETE CASCADE,
  class_id uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id text NOT NULL CHECK (char_length(device_id) BETWEEN 16 AND 128),
  mode text NOT NULL CHECK (mode IN ('temporary', 'persistent')),
  access_token_hash text NOT NULL UNIQUE,
  refresh_token_hash text UNIQUE,
  previous_refresh_token_hash text,
  idle_expires_at timestamptz NOT NULL,
  last_used_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  revoked_reason text CHECK (revoked_reason IS NULL OR char_length(revoked_reason) <= 120),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX sessions_user_active_idx ON sessions (user_id) WHERE revoked_at IS NULL;
CREATE INDEX sessions_family_idx ON sessions (family_id);
CREATE INDEX sessions_refresh_idx ON sessions (refresh_token_hash);
CREATE INDEX sessions_previous_refresh_idx ON sessions (previous_refresh_token_hash);
CREATE INDEX sessions_idle_idx ON sessions (idle_expires_at) WHERE revoked_at IS NULL;

CREATE TABLE gateway_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  remember boolean NOT NULL DEFAULT false,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX gateway_credentials_expiry_idx
  ON gateway_credentials (expires_at) WHERE revoked_at IS NULL;

CREATE TABLE recovery_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash text NOT NULL UNIQUE,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX recovery_codes_user_idx ON recovery_codes (user_id, created_at DESC);

CREATE TABLE login_failures (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  class_id uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  failed_count integer NOT NULL DEFAULT 0 CHECK (failed_count >= 0),
  locked_until timestamptz,
  last_failed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE role_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('student', 'general_admin', 'super_admin')),
  granted_by uuid REFERENCES users(id) ON DELETE SET NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  revoked_by uuid REFERENCES users(id) ON DELETE SET NULL
);

-- One active role per user and exactly one active super admin per class.
CREATE UNIQUE INDEX role_assignments_one_active
  ON role_assignments (class_id, user_id) WHERE revoked_at IS NULL;
CREATE UNIQUE INDEX role_assignments_one_super_admin
  ON role_assignments (class_id) WHERE role = 'super_admin' AND revoked_at IS NULL;
CREATE INDEX role_assignments_role_idx
  ON role_assignments (class_id, role) WHERE revoked_at IS NULL;

-- Keep updated_at honest on mutable identity rows.
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER classes_touch BEFORE UPDATE ON classes
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER users_touch BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER profiles_touch BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER password_credentials_touch BEFORE UPDATE ON password_credentials
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
