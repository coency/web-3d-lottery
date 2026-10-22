CREATE TABLE activity_configurations (
 activity_id uuid PRIMARY KEY REFERENCES activities(id),
 form jsonb NOT NULL DEFAULT '{"fields":[],"titleFieldId":null,"auxiliaryFieldIds":[]}',
 rule jsonb NOT NULL DEFAULT '{"mode":"once","maxWins":null}',
 prizes jsonb NOT NULL DEFAULT '[]'
);
CREATE TABLE configuration_versions (
 activity_id uuid NOT NULL REFERENCES activities(id), version bigint NOT NULL,
 form jsonb NOT NULL, rule jsonb NOT NULL, prizes jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY(activity_id,version)
);
CREATE TABLE prize_identities (
 id uuid PRIMARY KEY, activity_id uuid NOT NULL REFERENCES activities(id),
 UNIQUE(activity_id,id)
);
-- No public endpoint can set readiness. A future real WeChat verifier owns this evidence.
CREATE TABLE activity_wechat_verifications (
 activity_id uuid PRIMARY KEY REFERENCES activities(id),
 verified_at timestamptz NOT NULL, valid_until timestamptz NOT NULL,
 evidence_reference text NOT NULL CHECK(length(btrim(evidence_reference))>0),
 CHECK(valid_until>verified_at)
);
ALTER TABLE activity_runs ADD UNIQUE(activity_id,id,generation);
CREATE TABLE activity_participants (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),activity_id uuid NOT NULL,run_id uuid NOT NULL,generation integer NOT NULL,
 identity_key text NOT NULL,nickname text NOT NULL,answers jsonb NOT NULL DEFAULT '{}',
 form_version bigint NOT NULL,eligible boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(activity_id,run_id,generation) REFERENCES activity_runs(activity_id,id,generation),
 FOREIGN KEY(activity_id,form_version) REFERENCES configuration_versions(activity_id,version),
 UNIQUE(run_id,generation,identity_key),UNIQUE(activity_id,run_id,generation,id)
);
CREATE TABLE draw_rounds (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),activity_id uuid NOT NULL,run_id uuid NOT NULL,generation integer NOT NULL,
 prize_id uuid NOT NULL,config_version bigint NOT NULL,
 status text NOT NULL CHECK(status IN ('drawing','completed','expired')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(activity_id,run_id,generation) REFERENCES activity_runs(activity_id,id,generation),
 FOREIGN KEY(activity_id,prize_id) REFERENCES prize_identities(activity_id,id),
 FOREIGN KEY(activity_id,config_version) REFERENCES configuration_versions(activity_id,version),
 UNIQUE(activity_id,run_id,generation,id)
);
CREATE UNIQUE INDEX one_drawing_round ON draw_rounds(activity_id) WHERE status='drawing';
CREATE TABLE draw_awards (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),activity_id uuid NOT NULL,run_id uuid NOT NULL,generation integer NOT NULL,
 round_id uuid NOT NULL,participant_id uuid NOT NULL,prize_id uuid NOT NULL,
 status text NOT NULL CHECK(status IN ('valid','void')),reason text,
 FOREIGN KEY(activity_id,run_id,generation,round_id) REFERENCES draw_rounds(activity_id,run_id,generation,id),
 FOREIGN KEY(activity_id,run_id,generation,participant_id) REFERENCES activity_participants(activity_id,run_id,generation,id),
 FOREIGN KEY(activity_id,prize_id) REFERENCES prize_identities(activity_id,id)
);
CREATE UNIQUE INDEX one_valid_prize_per_person ON draw_awards(run_id,generation,prize_id,participant_id) WHERE status='valid';
CREATE TABLE designated_reservations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),activity_id uuid NOT NULL,run_id uuid NOT NULL,generation integer NOT NULL,
 participant_id uuid NOT NULL,prize_id uuid NOT NULL,
 status text NOT NULL CHECK(status IN ('reserved','issued','cancelled')),
 FOREIGN KEY(activity_id,run_id,generation,participant_id) REFERENCES activity_participants(activity_id,run_id,generation,id),
 FOREIGN KEY(activity_id,prize_id) REFERENCES prize_identities(activity_id,id)
);
CREATE UNIQUE INDEX one_reservation_per_prize ON designated_reservations(run_id,generation,prize_id,participant_id) WHERE status='reserved';
