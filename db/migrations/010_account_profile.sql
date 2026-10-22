ALTER TABLE sms_challenges DROP CONSTRAINT sms_challenges_purpose_check;
ALTER TABLE sms_challenges ADD CONSTRAINT sms_challenges_purpose_check CHECK(purpose IN ('register','reset','change_phone','change_phone_old'));
ALTER TABLE sms_challenges ADD COLUMN user_id uuid REFERENCES users(id);
