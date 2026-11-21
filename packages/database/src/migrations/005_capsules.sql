-- 005_capsules.sql
-- Time capsules: sealed until graduation (design §9, §18).

CREATE TABLE time_capsules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 100),
  -- Body is stored encrypted once the contribution deadline passes. Before
  -- sealing it is stored in content_plain for author edits; after sealing the
  -- plaintext column is nulled and content_enc holds the ciphertext.
  content_plain text CHECK (content_plain IS NULL OR char_length(content_plain) <= 10000),
  content_enc jsonb,
  visibility text NOT NULL CHECK (visibility IN ('class','recipient','self','collaborative')),
  unlock_at timestamptz NOT NULL,
  contribution_deadline timestamptz NOT NULL,
  sealed_at timestamptz,
  key_version integer NOT NULL DEFAULT 1 CHECK (key_version >= 1),
  media_object_keys text[] NOT NULL DEFAULT '{}' CHECK (cardinality(media_object_keys) <= 20),
  unlocked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (contribution_deadline <= unlock_at),
  CHECK (
    (sealed_at IS NULL AND content_plain IS NOT NULL AND content_enc IS NULL)
    OR (sealed_at IS NOT NULL AND content_plain IS NULL AND content_enc IS NOT NULL)
  )
);

CREATE INDEX time_capsules_class_idx ON time_capsules (class_id, unlock_at);
CREATE INDEX time_capsules_author_idx ON time_capsules (author_id, created_at DESC);
CREATE INDEX time_capsules_due_seal_idx ON time_capsules (contribution_deadline)
  WHERE sealed_at IS NULL;
CREATE INDEX time_capsules_due_unlock_idx ON time_capsules (unlock_at)
  WHERE unlocked_at IS NULL AND sealed_at IS NOT NULL;

CREATE TRIGGER time_capsules_touch BEFORE UPDATE ON time_capsules
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE capsule_recipients (
  capsule_id uuid NOT NULL REFERENCES time_capsules(id) ON DELETE CASCADE,
  class_id uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (capsule_id, user_id)
);

CREATE INDEX capsule_recipients_user_idx ON capsule_recipients (user_id, created_at DESC);

CREATE TABLE capsule_contributors (
  capsule_id uuid NOT NULL REFERENCES time_capsules(id) ON DELETE CASCADE,
  class_id uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Per-contributor sealed contribution. NULL until the contributor submits.
  contribution_plain text CHECK (contribution_plain IS NULL OR char_length(contribution_plain) <= 10000),
  contribution_enc jsonb,
  key_version integer NOT NULL DEFAULT 1 CHECK (key_version >= 1),
  submitted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (capsule_id, user_id)
);

CREATE INDEX capsule_contributors_user_idx ON capsule_contributors (user_id, created_at DESC);
