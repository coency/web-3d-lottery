ALTER TABLE activity_participants ADD COLUMN version bigint NOT NULL DEFAULT 1;
ALTER TABLE activity_participants ADD COLUMN exclusion_kind text;
ALTER TABLE activity_participants ADD COLUMN exclusion_reason text;
UPDATE activity_participants SET exclusion_kind='manual',exclusion_reason='历史排除记录' WHERE NOT eligible;
UPDATE activity_participants p SET exclusion_kind='absent' WHERE NOT eligible AND EXISTS(
 SELECT 1 FROM draw_awards a WHERE a.participant_id=p.id AND a.status='void' AND a.reason IN ('absent','not_present','不在场')
);
ALTER TABLE activity_participants ADD CONSTRAINT participant_exclusion_consistent
 CHECK((eligible AND exclusion_kind IS NULL) OR (NOT eligible AND exclusion_kind IS NOT NULL AND exclusion_kind IN ('manual','absent')));
CREATE TABLE participant_changes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 activity_id uuid NOT NULL,
 run_id uuid NOT NULL,
 generation integer NOT NULL,
 participant_id uuid NOT NULL,
 actor_id uuid NOT NULL REFERENCES users(id),
 kind text NOT NULL CHECK(kind IN ('answers','exclude','restore')),
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 300),
 before_value jsonb NOT NULL,
 after_value jsonb NOT NULL,
 participant_version bigint NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(activity_id,run_id,generation,participant_id) REFERENCES activity_participants(activity_id,run_id,generation,id) ON DELETE CASCADE,
 UNIQUE(participant_id,participant_version)
);
CREATE INDEX participant_change_history ON participant_changes(participant_id,created_at DESC);
