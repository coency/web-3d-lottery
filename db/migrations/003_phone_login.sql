-- Phone is already NOT NULL and UNIQUE. Preserve old account names only as legacy data.
-- Existing users retain their IDs, password hashes, phone numbers, activities and sessions.
ALTER TABLE users ALTER COLUMN account DROP NOT NULL;
COMMENT ON COLUMN users.account IS 'Legacy username retained for history only. Not accepted for login; new registrations leave NULL.';