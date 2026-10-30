-- Independent optional materials; existing activities and signup answers are untouched.
CREATE TABLE activity_materials (
 activity_id uuid PRIMARY KEY REFERENCES activities(id),
 content jsonb NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE assets DROP CONSTRAINT assets_purpose_check;
ALTER TABLE assets ADD CONSTRAINT assets_purpose_check
 CHECK (purpose IN ('activity_logo','h5_background','stage_background','activity_material'));
