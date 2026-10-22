CREATE TABLE sms_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone varchar(16) NOT NULL,
  purpose text NOT NULL CHECK (purpose IN ('register','reset')),
  code_hash text NOT NULL,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL DEFAULT clock_timestamp() + interval '5 minutes'
);
CREATE INDEX sms_phone_purpose_idx ON sms_challenges(phone,purpose,created_at DESC);
CREATE TABLE auth_limits (
  key text PRIMARY KEY,
  hits integer NOT NULL,
  started_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE auth_operations (
  key text PRIMARY KEY,
  request_hash text NOT NULL,
  receipt text NOT NULL,
  expires_at timestamptz NOT NULL DEFAULT clock_timestamp() + interval '24 hours'
);
CREATE TABLE auth_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid REFERENCES users(id),
  action text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX auth_audit_user_idx ON auth_audit(user_id,created_at DESC);
