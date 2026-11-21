-- 007_notifications_logging.sql
-- Notifications, HTTP request index (daily partitioned), staging detail,
-- semantic events, daily metrics (design §12, §14, §18).

CREATE TABLE notifications (
  seq bigint GENERATED ALWAYS AS IDENTITY,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  class_id uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (char_length(kind) BETWEEN 1 AND 40),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  body text NOT NULL DEFAULT '' CHECK (char_length(body) <= 500),
  href text CHECK (href IS NULL OR char_length(href) <= 300),
  -- Category switch so users can mute non-essential kinds (§12).
  muted boolean NOT NULL DEFAULT false,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

-- seq gives a monotonic cursor for SSE catch-up (§19).
CREATE UNIQUE INDEX notifications_seq_idx ON notifications (seq);
CREATE INDEX notifications_user_cursor_idx ON notifications (user_id, seq DESC);
CREATE INDEX notifications_user_unread_idx ON notifications (user_id)
  WHERE read_at IS NULL AND muted = false;

-- Compact HTTP request index, partitioned by day (§14.4). Sensitive values
-- (exact IP, User-Agent) are encrypted; ip_hmac enables correlation search.
CREATE TABLE request_log_index (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  request_id text NOT NULL CHECK (char_length(request_id) <= 80),
  class_id uuid,
  route text NOT NULL CHECK (char_length(route) <= 200),
  method text NOT NULL CHECK (char_length(method) <= 10),
  status_code integer NOT NULL CHECK (status_code BETWEEN 100 AND 599),
  duration_ms integer NOT NULL CHECK (duration_ms >= 0),
  response_bytes integer NOT NULL DEFAULT 0 CHECK (response_bytes >= 0),
  user_hmac text CHECK (user_hmac IS NULL OR char_length(user_hmac) = 64),
  session_hmac text CHECK (session_hmac IS NULL OR char_length(session_hmac) = 64),
  device_hmac text CHECK (device_hmac IS NULL OR char_length(device_hmac) = 64),
  ip_enc jsonb,
  user_agent_enc jsonb,
  ip_hmac text CHECK (ip_hmac IS NULL OR char_length(ip_hmac) = 64),
  rate_limited boolean NOT NULL DEFAULT false,
  timed_out boolean NOT NULL DEFAULT false,
  error_class text CHECK (error_class IS NULL OR char_length(error_class) <= 40),
  deploy_version text CHECK (deploy_version IS NULL OR char_length(deploy_version) <= 80),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

CREATE INDEX request_log_index_time_idx ON request_log_index (created_at DESC);
CREATE INDEX request_log_index_request_idx ON request_log_index (request_id);
CREATE INDEX request_log_index_route_idx ON request_log_index (route, created_at DESC);
CREATE INDEX request_log_index_ip_idx ON request_log_index (ip_hmac, created_at DESC);
CREATE INDEX request_log_index_status_idx ON request_log_index (status_code, created_at DESC);

-- Structured detail staged for export to U3 as gzipped JSONL. Deleted only
-- after a verified upload (§14.4). Also partitioned by day.
CREATE TABLE request_log_staging (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  request_id text NOT NULL CHECK (char_length(request_id) <= 80),
  detail jsonb NOT NULL,
  exported_at timestamptz,
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

CREATE INDEX request_log_staging_time_idx ON request_log_staging (created_at DESC);
CREATE INDEX request_log_staging_unexported_idx ON request_log_staging (created_at)
  WHERE exported_at IS NULL;

-- Create a daily partition for a partitioned table if it does not exist yet.
-- The default partition catches anything outside created ranges so inserts
-- never fail; maintenance can then split it.
CREATE OR REPLACE FUNCTION ensure_daily_partition(p_table regclass, p_day date)
RETURNS void AS $$
DECLARE
  part_name text;
  start_ts timestamptz;
  end_ts timestamptz;
BEGIN
  part_name := format('%s_%s', p_table::text, to_char(p_day, 'YYYYMMDD'));
  start_ts := p_day::timestamptz;
  end_ts := (p_day + 1)::timestamptz;
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = part_name) THEN
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS %I PARTITION OF %s FOR VALUES FROM (%L) TO (%L)',
      part_name, p_table, start_ts, end_ts
    );
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Default partitions so a missing daily partition never drops a request row.
CREATE TABLE request_log_index_default PARTITION OF request_log_index DEFAULT;
CREATE TABLE request_log_staging_default PARTITION OF request_log_staging DEFAULT;

CREATE TABLE semantic_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  event_type text NOT NULL CHECK (char_length(event_type) BETWEEN 1 AND 60),
  target_type text CHECK (target_type IS NULL OR char_length(target_type) <= 40),
  target_id text CHECK (target_id IS NULL OR char_length(target_id) <= 80),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  request_id text CHECK (request_id IS NULL OR char_length(request_id) <= 80),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX semantic_events_type_time_idx ON semantic_events (event_type, created_at DESC);
CREATE INDEX semantic_events_user_time_idx ON semantic_events (user_id, created_at DESC);
CREATE INDEX semantic_events_time_idx ON semantic_events (created_at DESC);

CREATE TABLE daily_metrics (
  metric_day date NOT NULL,
  class_id uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  pv bigint NOT NULL DEFAULT 0 CHECK (pv >= 0),
  uv bigint NOT NULL DEFAULT 0 CHECK (uv >= 0),
  active_accounts bigint NOT NULL DEFAULT 0 CHECK (active_accounts >= 0),
  peak_qps integer NOT NULL DEFAULT 0 CHECK (peak_qps >= 0),
  p50_ms integer NOT NULL DEFAULT 0 CHECK (p50_ms >= 0),
  p95_ms integer NOT NULL DEFAULT 0 CHECK (p95_ms >= 0),
  error_rate numeric(5,4) NOT NULL DEFAULT 0 CHECK (error_rate >= 0 AND error_rate <= 1),
  module_usage jsonb NOT NULL DEFAULT '{}'::jsonb,
  storage_bytes bigint NOT NULL DEFAULT 0 CHECK (storage_bytes >= 0),
  moderation_actions integer NOT NULL DEFAULT 0 CHECK (moderation_actions >= 0),
  identity_reveals integer NOT NULL DEFAULT 0 CHECK (identity_reveals >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (metric_day, class_id)
);

CREATE INDEX daily_metrics_class_idx ON daily_metrics (class_id, metric_day DESC);

CREATE TABLE security_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (char_length(kind) BETWEEN 1 AND 60),
  severity text NOT NULL DEFAULT 'info' CHECK (severity IN ('info','warning','critical')),
  subject_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  acknowledged_at timestamptz,
  acknowledged_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX security_alerts_time_idx ON security_alerts (class_id, created_at DESC);
