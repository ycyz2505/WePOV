-- 002_system_core.sql
-- Append-only audit, settings, storage accounting, idempotency (design §14, §15.2, §18).

CREATE TABLE audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
  actor_role text NOT NULL CHECK (char_length(actor_role) <= 40),
  action text NOT NULL CHECK (char_length(action) BETWEEN 1 AND 80),
  target_type text CHECK (target_type IS NULL OR char_length(target_type) <= 40),
  target_id text CHECK (target_id IS NULL OR char_length(target_id) <= 80),
  before_state jsonb,
  after_state jsonb,
  session_id uuid,
  request_id text CHECK (request_id IS NULL OR char_length(request_id) <= 80),
  ip_hmac text CHECK (ip_hmac IS NULL OR char_length(ip_hmac) <= 80),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX audit_events_class_time_idx ON audit_events (class_id, created_at DESC);
CREATE INDEX audit_events_actor_time_idx ON audit_events (actor_id, created_at DESC);
CREATE INDEX audit_events_action_time_idx ON audit_events (action, created_at DESC);
CREATE INDEX audit_events_target_idx ON audit_events (target_type, target_id);

-- Audit rows are append-only. The API has no update/delete path; this trigger
-- makes accidental mutation impossible even through ad-hoc SQL.
CREATE OR REPLACE FUNCTION forbid_audit_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_events_no_update BEFORE UPDATE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION forbid_audit_mutation();
CREATE TRIGGER audit_events_no_delete BEFORE DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION forbid_audit_mutation();

CREATE TABLE app_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  key text NOT NULL CHECK (char_length(key) BETWEEN 1 AND 80),
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (class_id, key)
);

CREATE TRIGGER app_settings_touch BEFORE UPDATE ON app_settings
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE storage_usage (
  class_id uuid PRIMARY KEY REFERENCES classes(id) ON DELETE CASCADE,
  used_bytes bigint NOT NULL DEFAULT 0 CHECK (used_bytes >= 0),
  quota_bytes bigint NOT NULL DEFAULT 9878424780 CHECK (quota_bytes > 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE idempotency_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key text NOT NULL CHECK (char_length(key) BETWEEN 1 AND 200),
  method text NOT NULL CHECK (char_length(method) <= 10),
  path text NOT NULL CHECK (char_length(path) <= 300),
  status_code integer NOT NULL CHECK (status_code BETWEEN 100 AND 599),
  response jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  UNIQUE (class_id, user_id, key)
);

CREATE INDEX idempotency_keys_expiry_idx ON idempotency_keys (expires_at);

CREATE TABLE recycle_bin_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  entity_type text NOT NULL CHECK (char_length(entity_type) BETWEEN 1 AND 40),
  entity_id uuid NOT NULL,
  label text NOT NULL DEFAULT '' CHECK (char_length(label) <= 200),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  deleted_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  restored_at timestamptz,
  restored_by uuid REFERENCES users(id) ON DELETE SET NULL,
  purged_at timestamptz
);

CREATE INDEX recycle_bin_class_time_idx ON recycle_bin_entries (class_id, created_at DESC);
CREATE INDEX recycle_bin_open_idx ON recycle_bin_entries (class_id) WHERE restored_at IS NULL AND purged_at IS NULL;
CREATE INDEX recycle_bin_entity_idx ON recycle_bin_entries (entity_type, entity_id);
