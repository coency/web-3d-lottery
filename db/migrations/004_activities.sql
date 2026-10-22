ALTER TABLE activities ADD COLUMN tagline varchar(200) NOT NULL DEFAULT '';
ALTER TABLE activities ADD COLUMN organizer varchar(100) NOT NULL DEFAULT '';
ALTER TABLE activities ADD COLUMN coorganizer varchar(100) NOT NULL DEFAULT '';
ALTER TABLE activities ADD COLUMN location varchar(200) NOT NULL DEFAULT '';
ALTER TABLE activities ADD COLUMN display jsonb NOT NULL DEFAULT '{"logo":true,"tagline":true,"organizer":true,"coorganizer":true,"location":true,"h5Background":true,"stageBackground":true}';
ALTER TABLE assets ADD COLUMN activity_id uuid;
ALTER TABLE assets ADD COLUMN upload_expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '15 minutes';
ALTER TABLE assets ADD COLUMN content_hash text;
ALTER TABLE assets ADD COLUMN width integer;
ALTER TABLE assets ADD COLUMN height integer;
ALTER TABLE assets ADD COLUMN bytes integer;
ALTER TABLE assets ADD FOREIGN KEY(owner_id,activity_id) REFERENCES activities(owner_id,id);
CREATE TABLE business_operations (
 owner_id uuid NOT NULL REFERENCES users(id), key uuid NOT NULL,
 request_hash text NOT NULL, receipt jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY(owner_id,key)
);
CREATE TABLE business_audit (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_id uuid NOT NULL REFERENCES users(id),
 target_user_id uuid NOT NULL REFERENCES users(id), activity_id uuid REFERENCES activities(id),
 action text NOT NULL, details jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX business_audit_target ON business_audit(target_user_id,created_at DESC);
