ALTER TABLE activities ALTER COLUMN h5_background_asset_id DROP NOT NULL;
COMMENT ON COLUMN activities.h5_background_asset_id IS 'Optional until configured in activity check-in settings.';
COMMENT ON COLUMN activities.location IS 'Legacy activity location; no longer exposed or editable.';
