-- Preserve accounts and data; revoke old privileged sessions.
DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE role='platform_admin');
UPDATE users SET role='user',login_version=login_version+1 WHERE role='platform_admin';
ALTER TABLE users DROP CONSTRAINT users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK(role='user');
-- Existing activity bindings keep their immutable credential for identity continuity.
UPDATE wechat_configurations SET source='custom',version=version+1 WHERE scope<>'platform' AND credential_id IS NULL;
DELETE FROM wechat_configurations WHERE scope='platform';
