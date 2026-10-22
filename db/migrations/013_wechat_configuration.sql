-- Credentials are immutable versions; existing activity bindings retain their identity.
CREATE TABLE wechat_credentials (
 id uuid PRIMARY KEY,
 owner_id uuid REFERENCES users(id),
 activity_id uuid,
 app_id varchar(64) NOT NULL,
 account_name varchar(80) NOT NULL,
 sealed_secret jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(owner_id,activity_id) REFERENCES activities(owner_id,id),
 CHECK((owner_id IS NULL AND activity_id IS NULL) OR (owner_id IS NOT NULL AND activity_id IS NOT NULL))
);
CREATE TABLE wechat_configurations (
 scope text PRIMARY KEY,
 source text NOT NULL CHECK(source IN ('platform','custom')),
 credential_id uuid REFERENCES wechat_credentials(id),
 version bigint NOT NULL DEFAULT 1,
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
INSERT INTO wechat_configurations(scope,source) VALUES('platform','platform');
