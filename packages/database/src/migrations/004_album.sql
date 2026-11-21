-- 004_album.sql
-- Album folders, media, variants, hashes and review requests (design §8, §18).

CREATE TABLE album_folders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  parent_id uuid REFERENCES album_folders(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  depth integer NOT NULL DEFAULT 0 CHECK (depth BETWEEN 0 AND 10),
  path text NOT NULL CHECK (char_length(path) <= 1024),
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX album_folders_parent_idx ON album_folders (class_id, parent_id, name);
CREATE INDEX album_folders_depth_idx ON album_folders (class_id, depth);
CREATE UNIQUE INDEX album_folders_sibling_name_unique
  ON album_folders (class_id, parent_id, name) WHERE parent_id IS NOT NULL;

CREATE TRIGGER album_folders_touch BEFORE UPDATE ON album_folders
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- Guarantee the 10-level cap and prevent cycles at the storage layer: a folder
-- may only point at a parent whose depth is exactly one less, and whose path is
-- a strict prefix of the child path. The API computes depth/path on insert.
CREATE OR REPLACE FUNCTION check_folder_depth() RETURNS trigger AS $$
DECLARE parent_depth integer;
BEGIN
  IF NEW.parent_id IS NULL THEN
    NEW.depth := 0;
    RETURN NEW;
  END IF;
  SELECT depth INTO parent_depth FROM album_folders WHERE id = NEW.parent_id;
  IF parent_depth IS NULL THEN
    RAISE EXCEPTION 'parent folder % not found', NEW.parent_id;
  END IF;
  IF parent_depth >= 10 THEN
    RAISE EXCEPTION 'album folders may not exceed 10 levels';
  END IF;
  NEW.depth := parent_depth + 1;
  IF NEW.depth > 10 THEN
    RAISE EXCEPTION 'album folders may not exceed 10 levels';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER album_folders_depth BEFORE INSERT OR UPDATE ON album_folders
  FOR EACH ROW EXECUTE FUNCTION check_folder_depth();

CREATE TABLE media_objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  folder_id uuid NOT NULL REFERENCES album_folders(id) ON DELETE CASCADE,
  uploader_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  object_key text NOT NULL CHECK (char_length(object_key) <= 512),
  original_filename text NOT NULL CHECK (char_length(original_filename) <= 255),
  mime text NOT NULL
    CHECK (mime IN ('image/jpeg','image/png','image/webp','image/heic','image/heif')),
  original_bytes bigint NOT NULL CHECK (original_bytes > 0 AND original_bytes <= 41943040),
  final_bytes bigint NOT NULL CHECK (final_bytes > 0 AND final_bytes <= 41943040),
  width integer NOT NULL CHECK (width > 0 AND width <= 20000),
  height integer NOT NULL CHECK (height > 0 AND height <= 20000),
  sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  tier text NOT NULL CHECK (tier IN ('original','high','standard','compact','custom')),
  preserve_original_bytes boolean NOT NULL DEFAULT false,
  captured_at timestamptz,
  status text NOT NULL DEFAULT 'quarantine'
    CHECK (status IN ('quarantine','active','hidden','pending_delete','deleted')),
  review_status text NOT NULL DEFAULT 'none'
    CHECK (review_status IN ('none','pending','approved','rejected')),
  hidden_by_request boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (width::bigint * height::bigint <= 60000000)
);

-- Dedupe is class-scoped on sha256 + size (§8.5). The unique index lets
-- concurrent uploads collide instead of producing duplicate objects.
CREATE UNIQUE INDEX media_objects_dedupe_unique
  ON media_objects (class_id, sha256, final_bytes)
  WHERE status <> 'deleted';
CREATE INDEX media_objects_folder_idx ON media_objects (folder_id, created_at DESC)
  WHERE status IN ('active','hidden','pending_delete');
CREATE INDEX media_objects_uploader_idx ON media_objects (uploader_id, created_at DESC);
CREATE INDEX media_objects_review_idx ON media_objects (class_id, review_status)
  WHERE review_status = 'pending';
CREATE INDEX media_objects_status_idx ON media_objects (class_id, status, created_at DESC);

CREATE TRIGGER media_objects_touch BEFORE UPDATE ON media_objects
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- Variants hold alternate renditions (high/standard/compact/original). The
-- client encodes them; the server never transcodes (§8.4, zero-budget).
CREATE TABLE media_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  media_id uuid NOT NULL REFERENCES media_objects(id) ON DELETE CASCADE,
  tier text NOT NULL CHECK (tier IN ('original','high','standard','compact','custom')),
  object_key text NOT NULL CHECK (char_length(object_key) <= 512),
  bytes bigint NOT NULL CHECK (bytes > 0),
  width integer NOT NULL CHECK (width > 0),
  height integer NOT NULL CHECK (height > 0),
  mime text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (media_id, tier)
);

CREATE INDEX media_variants_media_idx ON media_variants (media_id);

-- Redundant-by-design hash table for fast client duplicate pre-checks and
-- audit of the computed digest per object.
CREATE TABLE media_hashes (
  class_id uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  size_bytes bigint NOT NULL CHECK (size_bytes > 0),
  media_id uuid REFERENCES media_objects(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (class_id, sha256, size_bytes)
);

CREATE TABLE media_delete_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  media_id uuid NOT NULL REFERENCES media_objects(id) ON DELETE CASCADE,
  requester_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason text NOT NULL DEFAULT '' CHECK (char_length(reason) <= 500),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','rejected','expired','cancelled')),
  handled_by uuid REFERENCES users(id) ON DELETE SET NULL,
  handled_at timestamptz,
  due_at timestamptz NOT NULL DEFAULT (now() + interval '14 days'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX media_delete_requests_queue_idx ON media_delete_requests (class_id, status, created_at);
CREATE INDEX media_delete_requests_media_idx ON media_delete_requests (media_id);
CREATE UNIQUE INDEX media_delete_requests_one_pending
  ON media_delete_requests (media_id) WHERE status = 'pending';

CREATE TABLE folder_change_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  folder_id uuid NOT NULL REFERENCES album_folders(id) ON DELETE CASCADE,
  requester_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  operation text NOT NULL CHECK (operation IN ('move','delete')),
  target_parent_id uuid REFERENCES album_folders(id) ON DELETE SET NULL,
  reason text NOT NULL DEFAULT '' CHECK (char_length(reason) <= 500),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','rejected','expired','cancelled')),
  handled_by uuid REFERENCES users(id) ON DELETE SET NULL,
  handled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX folder_change_requests_queue_idx ON folder_change_requests (class_id, status, created_at);
CREATE UNIQUE INDEX folder_change_requests_one_pending
  ON folder_change_requests (folder_id) WHERE status = 'pending';
