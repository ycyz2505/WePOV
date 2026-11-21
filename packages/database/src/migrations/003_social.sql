-- 003_social.sql
-- Plaza graph, tree hole (anonymous), reports and moderation (design §5, §6, §18).

CREATE TABLE follows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  follower_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  followee_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (follower_id <> followee_id),
  UNIQUE (class_id, follower_id, followee_id)
);

CREATE INDEX follows_followee_idx ON follows (class_id, followee_id, created_at DESC);
CREATE INDEX follows_follower_idx ON follows (class_id, follower_id, created_at DESC);

-- Likes are repeatable and non-revocable (§5.6). The 50-per-day-per-target cap
-- is enforced by a serializable transaction in the API; this table stores the
-- UTC day so the count query and indexes stay cheap.
CREATE TABLE profile_likes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  liker_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  like_day date NOT NULL DEFAULT ((now() AT TIME ZONE 'UTC')::date),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (liker_id <> target_user_id)
);

CREATE INDEX profile_likes_target_idx ON profile_likes (class_id, target_user_id, created_at DESC);
CREATE INDEX profile_likes_day_idx
  ON profile_likes (class_id, liker_id, target_user_id, like_day);

CREATE TABLE partner_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 80),
  kind text NOT NULL CHECK (kind IN ('meal','study','sport','entertainment','travel','activity','other')),
  starts_at timestamptz NOT NULL,
  location text NOT NULL CHECK (char_length(location) BETWEEN 1 AND 120),
  capacity integer NOT NULL CHECK (capacity BETWEEN 2 AND 60),
  accepted_count integer NOT NULL DEFAULT 0 CHECK (accepted_count >= 0),
  expires_at timestamptz NOT NULL,
  description text NOT NULL DEFAULT '' CHECK (char_length(description) <= 800),
  allow_waitlist boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','full','closed','expired','cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at),
  CHECK (accepted_count <= capacity)
);

CREATE INDEX partner_posts_feed_idx ON partner_posts (class_id, status, expires_at);
CREATE INDEX partner_posts_author_idx ON partner_posts (author_id, created_at DESC);

CREATE TRIGGER partner_posts_touch BEFORE UPDATE ON partner_posts
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE partner_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  post_id uuid NOT NULL REFERENCES partner_posts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  note text NOT NULL DEFAULT '' CHECK (char_length(note) <= 120),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','accepted','waitlist','declined','cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (post_id, user_id)
);

CREATE INDEX partner_responses_post_idx ON partner_responses (post_id, status);
CREATE INDEX partner_responses_user_idx ON partner_responses (user_id, created_at DESC);

CREATE TRIGGER partner_responses_touch BEFORE UPDATE ON partner_responses
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE tree_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  content text NOT NULL CHECK (char_length(content) BETWEEN 1 AND 3000),
  tags text[] NOT NULL DEFAULT '{}' CHECK (cardinality(tags) <= 5),
  allow_bullet_screen boolean NOT NULL DEFAULT false,
  poll jsonb,
  status text NOT NULL DEFAULT 'visible'
    CHECK (status IN ('visible','hidden','removed','collapsed')),
  moderation_note text CHECK (moderation_note IS NULL OR char_length(moderation_note) <= 500),
  comment_count integer NOT NULL DEFAULT 0 CHECK (comment_count >= 0),
  reaction_count integer NOT NULL DEFAULT 0 CHECK (reaction_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX tree_posts_feed_idx ON tree_posts (class_id, status, created_at DESC);
CREATE INDEX tree_posts_tags_idx ON tree_posts USING gin (tags);
CREATE INDEX tree_posts_active_idx ON tree_posts (class_id, reaction_count DESC, created_at DESC)
  WHERE status = 'visible';
CREATE INDEX tree_posts_bullet_idx ON tree_posts (class_id, created_at DESC)
  WHERE allow_bullet_screen = true AND status = 'visible';

CREATE TRIGGER tree_posts_touch BEFORE UPDATE ON tree_posts
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- Tree content is visible to the whole class; authorship is not. The author
-- mapping lives in a separate encrypted table that only the super admin can
-- decrypt through an audited endpoint (§6.2).
CREATE TABLE tree_identity_map (
  post_id uuid PRIMARY KEY REFERENCES tree_posts(id) ON DELETE CASCADE,
  class_id uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  author_enc jsonb NOT NULL,
  author_hmac text NOT NULL CHECK (char_length(author_hmac) = 64),
  key_version integer NOT NULL DEFAULT 1 CHECK (key_version >= 1),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX tree_identity_map_hmac_idx ON tree_identity_map (class_id, author_hmac);

CREATE TABLE tree_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  post_id uuid NOT NULL REFERENCES tree_posts(id) ON DELETE CASCADE,
  parent_comment_id uuid REFERENCES tree_comments(id) ON DELETE CASCADE,
  content text NOT NULL CHECK (char_length(content) BETWEEN 1 AND 1000),
  -- HMAC of the author id. The human-facing alias is resolved per post through
  -- tree_comment_aliases so it cannot be linked across discussions.
  author_hmac text NOT NULL CHECK (char_length(author_hmac) = 64),
  is_op boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'visible'
    CHECK (status IN ('visible','hidden','removed','collapsed')),
  moderation_note text CHECK (moderation_note IS NULL OR char_length(moderation_note) <= 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX tree_comments_post_idx ON tree_comments (post_id, created_at);
CREATE INDEX tree_comments_parent_idx ON tree_comments (parent_comment_id);
CREATE INDEX tree_comments_hmac_idx ON tree_comments (class_id, author_hmac);

CREATE TRIGGER tree_comments_touch BEFORE UPDATE ON tree_comments
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- One stable alias per participant per discussion (§6.1).
CREATE TABLE tree_comment_aliases (
  post_id uuid NOT NULL REFERENCES tree_posts(id) ON DELETE CASCADE,
  class_id uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  author_hmac text NOT NULL CHECK (char_length(author_hmac) = 64),
  alias text NOT NULL CHECK (char_length(alias) BETWEEN 1 AND 16),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, author_hmac)
);

CREATE UNIQUE INDEX tree_comment_aliases_unique_alias
  ON tree_comment_aliases (post_id, alias);

CREATE TABLE tree_comment_identities (
  comment_id uuid PRIMARY KEY REFERENCES tree_comments(id) ON DELETE CASCADE,
  class_id uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  author_enc jsonb NOT NULL,
  key_version integer NOT NULL DEFAULT 1 CHECK (key_version >= 1)
);

CREATE TABLE tree_reactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  post_id uuid NOT NULL REFERENCES tree_posts(id) ON DELETE CASCADE,
  reactor_hmac text NOT NULL CHECK (char_length(reactor_hmac) = 64),
  reaction text NOT NULL DEFAULT 'like' CHECK (reaction IN ('like','hug','wow','sad')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (post_id, reactor_hmac, reaction)
);

CREATE INDEX tree_reactions_post_idx ON tree_reactions (post_id);

CREATE TABLE reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  reporter_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_type text NOT NULL
    CHECK (target_type IN ('tree_post','tree_comment','partner_post','profile','media')),
  target_id uuid NOT NULL,
  reason text NOT NULL
    CHECK (reason IN ('harassment','bullying','privacy','sexual','danger','spam','other')),
  details text NOT NULL DEFAULT '' CHECK (char_length(details) <= 500),
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','reviewing','resolved','dismissed')),
  handled_by uuid REFERENCES users(id) ON DELETE SET NULL,
  handled_at timestamptz,
  resolution_note text CHECK (resolution_note IS NULL OR char_length(resolution_note) <= 500),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX reports_queue_idx ON reports (class_id, status, created_at);
CREATE INDEX reports_target_idx ON reports (target_type, target_id);
CREATE UNIQUE INDEX reports_one_open_per_reporter
  ON reports (class_id, reporter_id, target_type, target_id) WHERE status IN ('open','reviewing');

CREATE TABLE moderation_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  operator_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_type text NOT NULL CHECK (char_length(target_type) BETWEEN 1 AND 40),
  target_id uuid NOT NULL,
  action text NOT NULL
    CHECK (action IN ('hide','remove','collapse','restore','mute','unmute')),
  reason text NOT NULL DEFAULT '' CHECK (char_length(reason) <= 500),
  show_reason_to_subject boolean NOT NULL DEFAULT false,
  show_operator boolean NOT NULL DEFAULT false,
  duration_minutes integer CHECK (duration_minutes IS NULL OR duration_minutes BETWEEN 1 AND 43200),
  -- Every moderation action must reference the audit row written in the same
  -- transaction (§15.2). RESTRICT means the audit row cannot be orphaned.
  audit_event_id uuid NOT NULL REFERENCES audit_events(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX moderation_actions_target_idx ON moderation_actions (target_type, target_id, created_at DESC);
CREATE INDEX moderation_actions_operator_idx ON moderation_actions (operator_id, created_at DESC);
CREATE INDEX moderation_actions_class_time_idx ON moderation_actions (class_id, created_at DESC);
