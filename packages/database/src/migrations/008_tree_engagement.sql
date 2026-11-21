-- 008_tree_engagement.sql
-- Per-user tree-hole engagement: poll votes and saved posts (design §6.1).
--
-- These are intentionally separate from tree_posts so a normal feed query never
-- touches them, and so poll participation stays anonymous: votes are keyed by
-- the voter's HMAC (same pseudonym scheme as reactions), never a raw user id.

CREATE TABLE tree_poll_votes (
  class_id uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  post_id uuid NOT NULL REFERENCES tree_posts(id) ON DELETE CASCADE,
  voter_hmac text NOT NULL CHECK (char_length(voter_hmac) = 64),
  option_id text NOT NULL CHECK (char_length(option_id) BETWEEN 1 AND 40),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, voter_hmac, option_id)
);

CREATE INDEX tree_poll_votes_post_idx ON tree_poll_votes (post_id);

-- Saved ("收藏") posts. Personal, so it is keyed by the real user id and is only
-- ever queried for the caller.
CREATE TABLE tree_saves (
  class_id uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  post_id uuid NOT NULL REFERENCES tree_posts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);

CREATE INDEX tree_saves_user_idx ON tree_saves (user_id, created_at DESC);
