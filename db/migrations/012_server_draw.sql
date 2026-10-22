ALTER TABLE draw_rounds ADD COLUMN root_round_id uuid;
ALTER TABLE draw_rounds ADD COLUMN candidates jsonb NOT NULL DEFAULT '[]';
ALTER TABLE draw_rounds ADD COLUMN snapshot jsonb NOT NULL DEFAULT '{}';
ALTER TABLE draw_rounds ADD COLUMN draw_count integer NOT NULL DEFAULT 0 CHECK(draw_count BETWEEN 0 AND 5);
ALTER TABLE draw_rounds ADD COLUMN replacements jsonb NOT NULL DEFAULT '[]';
ALTER TABLE draw_rounds ADD COLUMN completed_at timestamptz;
ALTER TABLE draw_rounds ADD CONSTRAINT round_root_fk FOREIGN KEY(activity_id,run_id,generation,root_round_id) REFERENCES draw_rounds(activity_id,run_id,generation,id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE activity_runs ADD COLUMN active_root_id uuid;
ALTER TABLE activity_runs ADD CONSTRAINT run_active_root_fk FOREIGN KEY(activity_id,id,generation,active_root_id) REFERENCES draw_rounds(activity_id,run_id,generation,id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE draw_awards ADD COLUMN display_snapshot jsonb NOT NULL DEFAULT '{}';
ALTER TABLE draw_awards ADD COLUMN replaces_award_id uuid;
ALTER TABLE draw_awards ADD COLUMN created_at timestamptz NOT NULL DEFAULT clock_timestamp();
ALTER TABLE draw_awards ADD UNIQUE(activity_id,run_id,generation,id);
ALTER TABLE draw_awards ADD CONSTRAINT award_replaces_fk FOREIGN KEY(activity_id,run_id,generation,replaces_award_id) REFERENCES draw_awards(activity_id,run_id,generation,id) DEFERRABLE INITIALLY DEFERRED;
CREATE UNIQUE INDEX award_one_replacement ON draw_awards(replaces_award_id) WHERE replaces_award_id IS NOT NULL;
CREATE TABLE draw_controls (
 run_id uuid PRIMARY KEY REFERENCES activity_runs(id),
 generation integer NOT NULL,session_hash text NOT NULL,tab_id uuid NOT NULL,
 fence bigint NOT NULL DEFAULT 1,lease_until timestamptz NOT NULL
);
