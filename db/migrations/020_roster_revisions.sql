-- Separate roster invalidation from awards/configuration changes. No participant data is cached here.
CREATE TABLE roster_revisions (
 run_id uuid PRIMARY KEY REFERENCES activity_runs(id) ON DELETE CASCADE,
 revision bigint NOT NULL DEFAULT 1
);
INSERT INTO roster_revisions(run_id) SELECT id FROM activity_runs;
CREATE FUNCTION mark_roster_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND
    ROW(NEW.run_id,NEW.generation,NEW.id,NEW.nickname,NEW.avatar_url,NEW.eligible,NEW.created_at)
    IS NOT DISTINCT FROM
    ROW(OLD.run_id,OLD.generation,OLD.id,OLD.nickname,OLD.avatar_url,OLD.eligible,OLD.created_at)
 THEN RETURN NULL; END IF;
 IF TG_OP IN ('UPDATE','DELETE') THEN
  INSERT INTO roster_revisions(run_id) VALUES(OLD.run_id)
  ON CONFLICT(run_id) DO UPDATE SET revision=roster_revisions.revision+1;
 END IF;
 IF TG_OP='INSERT' OR (TG_OP='UPDATE' AND NEW.run_id IS DISTINCT FROM OLD.run_id) THEN
  INSERT INTO roster_revisions(run_id) VALUES(NEW.run_id)
  ON CONFLICT(run_id) DO UPDATE SET revision=roster_revisions.revision+1;
 END IF;
 RETURN NULL;
END $$;
CREATE TRIGGER roster_changed AFTER INSERT OR UPDATE OR DELETE ON activity_participants
 FOR EACH ROW EXECUTE FUNCTION mark_roster_changed();
