-- First foundational entities only. No accounts or demo participants are seeded.
CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account varchar(32) NOT NULL UNIQUE CHECK (account ~ '^[a-z0-9_]{4,32}$'),
  password_hash text NOT NULL,
  phone varchar(16) NOT NULL UNIQUE CHECK (phone ~ '^\+861[0-9]{10}$'),
  role text NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'platform_admin')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  login_version bigint NOT NULL DEFAULT 0 CHECK (login_version >= 0),
  created_activity_count integer NOT NULL DEFAULT 0 CHECK (created_activity_count >= 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  token_hash text NOT NULL UNIQUE,
  login_version bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL CHECK (expires_at > created_at)
);
CREATE INDEX sessions_user_idx ON sessions(user_id);
CREATE INDEX sessions_expiry_idx ON sessions(expires_at);
CREATE TABLE entitlements (
  user_id uuid PRIMARY KEY REFERENCES users(id),
  paid_until timestamptz
);
CREATE TABLE assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id),
  object_key text NOT NULL UNIQUE,
  purpose text NOT NULL CHECK (purpose IN ('activity_logo','h5_background','stage_background')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','ready','failed')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (owner_id, id)
);
CREATE TABLE activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id),
  name varchar(100) NOT NULL CHECK (length(btrim(name)) > 0),
  logo_asset_id uuid NOT NULL,
  h5_background_asset_id uuid NOT NULL,
  stage_background_asset_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  phase text NOT NULL DEFAULT 'rehearsal' CHECK (phase IN ('rehearsal','formal','expired')),
  first_formal_started_at timestamptz,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (owner_id, id),
  CHECK (expires_at > created_at AND expires_at <= created_at + interval '30 days'),
  FOREIGN KEY (owner_id, logo_asset_id) REFERENCES assets(owner_id, id),
  FOREIGN KEY (owner_id, h5_background_asset_id) REFERENCES assets(owner_id, id),
  FOREIGN KEY (owner_id, stage_background_asset_id) REFERENCES assets(owner_id, id)
);
CREATE INDEX activities_owner_idx ON activities(owner_id, created_at DESC);
CREATE INDEX activities_expiry_idx ON activities(expires_at);
CREATE TABLE activity_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  activity_id uuid NOT NULL,
  mode text NOT NULL CHECK (mode IN ('rehearsal','formal')),
  generation integer NOT NULL DEFAULT 1 CHECK (generation > 0),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  first_started_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (activity_id, mode),
  UNIQUE (owner_id, activity_id, id),
  FOREIGN KEY (owner_id, activity_id) REFERENCES activities(owner_id, id)
);
-- Creation anchors never move when editing or clearing rehearsal data.
CREATE FUNCTION protect_activity_created_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'activity creation time is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER activity_created_at_immutable BEFORE UPDATE ON activities
FOR EACH ROW EXECUTE FUNCTION protect_activity_created_at();
