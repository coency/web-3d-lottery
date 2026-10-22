CREATE INDEX participant_roster_order ON activity_participants(run_id,generation,created_at,id);
CREATE TABLE participant_exports (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 owner_id uuid NOT NULL REFERENCES users(id),
 activity_id uuid NOT NULL REFERENCES activities(id),
 run_id uuid NOT NULL REFERENCES activity_runs(id),
 generation integer NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','ready','failed','expired')),
 snapshot jsonb,
 file_bytes bytea,
 filename text NOT NULL,
 row_count integer NOT NULL CHECK(row_count>=0),
 attempts integer NOT NULL DEFAULT 0,
 lease_token uuid,
 lease_until timestamptz,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '24 hours',
 completed_at timestamptz,
 error_code text
);
CREATE INDEX participant_exports_queue ON participant_exports(status,created_at);
CREATE INDEX participant_exports_owner ON participant_exports(owner_id,activity_id,created_at DESC);
