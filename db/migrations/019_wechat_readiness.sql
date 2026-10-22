-- Deployment readiness is distinct from a participant's OAuth authorization.
CREATE TABLE activity_wechat_readiness (
 activity_id uuid PRIMARY KEY REFERENCES activities(id),
 credential_id uuid NOT NULL REFERENCES wechat_credentials(id),
 origin text NOT NULL,
 filename text NOT NULL CHECK(filename ~ '^MP_verify_[A-Za-z0-9_]+\.txt$'),
 file_hash char(64) NOT NULL,
 confirmed_by uuid NOT NULL REFERENCES users(id),
 checked_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
