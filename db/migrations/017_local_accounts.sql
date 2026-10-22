-- Keep legacy identifiers and business ownership intact; new installations need no phone.
ALTER TABLE users ALTER COLUMN phone DROP NOT NULL;
ALTER TABLE users ADD COLUMN login_name varchar(32);
UPDATE users SET login_name = substring(phone from 4);
ALTER TABLE users ADD CONSTRAINT users_login_name_check
  CHECK (login_name IS NULL OR login_name ~ '^[a-z0-9_][a-z0-9_.-]{3,31}$');
ALTER TABLE users ADD CONSTRAINT users_login_identity_check
  CHECK (login_name IS NOT NULL OR phone IS NOT NULL);
CREATE UNIQUE INDEX users_login_identity_idx ON users ((coalesce(login_name, substring(phone from 4))));
COMMENT ON COLUMN users.login_name IS 'Canonical lowercase login name; existing users retain their 11-digit phone login. Legacy account column is not used.';
-- Removed SMS endpoints cannot consume pending challenges. Retain the table for migration history.
UPDATE sms_challenges SET consumed_at=coalesce(consumed_at,clock_timestamp());
