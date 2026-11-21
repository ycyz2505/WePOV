-- 006_classroom_boss.sql
-- Virtual classroom, focus sessions, encouragement, gifts, Boss seasons
-- (design §10, §11, §18).

CREATE TABLE seat_layouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  columns integer NOT NULL CHECK (columns BETWEEN 1 AND 30),
  rows integer NOT NULL CHECK (rows BETWEEN 1 AND 30),
  is_active boolean NOT NULL DEFAULT true,
  -- seats: [{ "seatIndex": n, "row": r, "col": c, "userId": uuid | null }]
  seats jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX seat_layouts_one_active ON seat_layouts (class_id) WHERE is_active = true;
CREATE INDEX seat_layouts_class_idx ON seat_layouts (class_id, created_at DESC);

CREATE TRIGGER seat_layouts_touch BEFORE UPDATE ON seat_layouts
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE focus_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  duration_minutes integer NOT NULL CHECK (duration_minutes BETWEEN 5 AND 240),
  note text NOT NULL DEFAULT '' CHECK (char_length(note) <= 80),
  started_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz NOT NULL,
  completed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX focus_sessions_active_idx ON focus_sessions (class_id, ends_at)
  WHERE completed_at IS NULL AND cancelled_at IS NULL;
CREATE INDEX focus_sessions_user_idx ON focus_sessions (user_id, started_at DESC);

CREATE TABLE encouragement_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('note','snack','lamp')),
  message text NOT NULL DEFAULT '' CHECK (char_length(message) <= 120),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (sender_id <> recipient_id)
);

CREATE INDEX encouragement_notes_recipient_idx
  ON encouragement_notes (recipient_id, created_at DESC);
CREATE INDEX encouragement_notes_pair_day_idx
  ON encouragement_notes (class_id, sender_id, recipient_id, created_at DESC);

CREATE TABLE virtual_gifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  gift_key text NOT NULL CHECK (char_length(gift_key) BETWEEN 1 AND 40),
  message text NOT NULL DEFAULT '' CHECK (char_length(message) <= 120),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (sender_id <> recipient_id)
);

CREATE INDEX virtual_gifts_recipient_idx ON virtual_gifts (recipient_id, created_at DESC);

CREATE TABLE boss_seasons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  target_points integer NOT NULL CHECK (target_points > 0),
  current_points integer NOT NULL DEFAULT 0 CHECK (current_points >= 0),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  reward text NOT NULL DEFAULT '' CHECK (char_length(reward) <= 200),
  status text NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled','active','completed','cancelled')),
  -- Daily cap per behaviour kind; defaults applied by the API on create.
  daily_caps jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);

CREATE UNIQUE INDEX boss_seasons_one_active ON boss_seasons (class_id) WHERE status = 'active';
CREATE INDEX boss_seasons_class_idx ON boss_seasons (class_id, starts_at DESC);

CREATE TRIGGER boss_seasons_touch BEFORE UPDATE ON boss_seasons
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE boss_contributions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  season_id uuid NOT NULL REFERENCES boss_seasons(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('focus','resource','answer','mutual_help','challenge')),
  points integer NOT NULL CHECK (points > 0),
  contribution_day date NOT NULL DEFAULT ((now() AT TIME ZONE 'UTC')::date),
  -- Dedupe key so retries / double-taps cannot double-count a single behaviour.
  source_ref text NOT NULL CHECK (char_length(source_ref) BETWEEN 1 AND 120),
  revoked_at timestamptz,
  revoked_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX boss_contributions_dedupe
  ON boss_contributions (season_id, user_id, kind, source_ref) WHERE revoked_at IS NULL;
CREATE INDEX boss_contributions_daily_cap_idx
  ON boss_contributions (season_id, user_id, kind, contribution_day) WHERE revoked_at IS NULL;
CREATE INDEX boss_contributions_season_idx ON boss_contributions (season_id, created_at DESC);

-- Study resources and answers are the evidence behind 'resource' and 'answer'
-- Boss contributions (§11.2). They are simple shared notes, not graded work.
CREATE TABLE study_resources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 20000),
  subject text NOT NULL DEFAULT '' CHECK (char_length(subject) <= 40),
  content_hash text NOT NULL CHECK (char_length(content_hash) = 64),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Repeated notes do not earn repeated points (§11.3).
CREATE UNIQUE INDEX study_resources_dedupe ON study_resources (class_id, author_id, content_hash);
CREATE INDEX study_resources_feed_idx ON study_resources (class_id, created_at DESC);

CREATE TABLE study_answers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  question_id uuid NOT NULL REFERENCES study_resources(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 8000),
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX study_answers_question_idx ON study_answers (question_id, created_at);
CREATE UNIQUE INDEX study_answers_one_per_author
  ON study_answers (question_id, author_id);
