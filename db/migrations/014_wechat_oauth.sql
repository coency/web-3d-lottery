CREATE TABLE join_entries (
 code varchar(48) PRIMARY KEY CHECK(code ~ '^[0-9a-f]{48}$'),
 activity_id uuid NOT NULL REFERENCES activities(id),
 run_id uuid NOT NULL UNIQUE REFERENCES activity_runs(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE wechat_oauth_states (
 token_hash char(64) PRIMARY KEY,
 entry_code varchar(48) NOT NULL REFERENCES join_entries(code),
 generation integer NOT NULL,
 credential_id uuid NOT NULL REFERENCES wechat_credentials(id),
 browser_hash char(64) NOT NULL,
 provider text NOT NULL CHECK(provider IN ('wechat','mock')),
 expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '10 minutes',
 consumed_at timestamptz
);
CREATE INDEX oauth_state_expiry ON wechat_oauth_states(expires_at);
CREATE TABLE join_avatars (
 id uuid PRIMARY KEY,
 entry_code varchar(48) NOT NULL REFERENCES join_entries(code),
 bytes bytea NOT NULL CHECK(octet_length(bytes)<=524288),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE participant_sessions (
 token_hash char(64) PRIMARY KEY,
 entry_code varchar(48) NOT NULL REFERENCES join_entries(code),
 generation integer NOT NULL,
 credential_id uuid NOT NULL REFERENCES wechat_credentials(id),
 provider text NOT NULL CHECK(provider IN ('wechat','mock')),
 identity_key text NOT NULL,
 nickname varchar(64),
 avatar_id uuid REFERENCES join_avatars(id),
 expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '2 hours'
);
CREATE INDEX participant_session_expiry ON participant_sessions(expires_at);
ALTER TABLE activity_participants ADD COLUMN profile_source text NOT NULL DEFAULT 'legacy';
ALTER TABLE activity_wechat_verifications ADD COLUMN credential_id uuid REFERENCES wechat_credentials(id);
