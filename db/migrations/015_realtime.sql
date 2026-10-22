-- Durable invalidation revisions: no participant data and no unbounded event log.
CREATE TABLE activity_revisions (
 activity_id uuid PRIMARY KEY REFERENCES activities(id),
 revision bigint NOT NULL DEFAULT 1
);
INSERT INTO activity_revisions(activity_id) SELECT id FROM activities;
CREATE FUNCTION mark_activity_changed() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target uuid;
BEGIN
 IF TG_TABLE_NAME='activities' THEN target=COALESCE(NEW.id,OLD.id);
 ELSE target=COALESCE(NEW.activity_id,OLD.activity_id); END IF;
 INSERT INTO activity_revisions(activity_id) VALUES(target)
 ON CONFLICT(activity_id) DO UPDATE SET revision=activity_revisions.revision+1;
 RETURN NULL;
END $$;
CREATE TRIGGER activity_changed AFTER INSERT OR UPDATE ON activities FOR EACH ROW EXECUTE FUNCTION mark_activity_changed();
CREATE TRIGGER configuration_changed AFTER INSERT OR UPDATE ON activity_configurations FOR EACH ROW EXECUTE FUNCTION mark_activity_changed();
CREATE TRIGGER run_changed AFTER INSERT OR UPDATE ON activity_runs FOR EACH ROW EXECUTE FUNCTION mark_activity_changed();
CREATE TRIGGER participant_changed AFTER INSERT OR UPDATE OR DELETE ON activity_participants FOR EACH ROW EXECUTE FUNCTION mark_activity_changed();
CREATE TRIGGER award_changed AFTER INSERT OR UPDATE OR DELETE ON draw_awards FOR EACH ROW EXECUTE FUNCTION mark_activity_changed();
