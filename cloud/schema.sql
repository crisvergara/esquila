-- esquila-cloud schema. Applied idempotently at boot.

CREATE TABLE IF NOT EXISTS shearing_events (
  id uuid PRIMARY KEY,
  tag text NOT NULL,
  station int,
  color text,
  lactation text,
  type text,
  wool_quality text,
  occurred_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  deleted_at timestamptz,
  origin text NOT NULL DEFAULT 'unknown'
);
CREATE INDEX IF NOT EXISTS idx_shearing_events_tag ON shearing_events (tag);
CREATE INDEX IF NOT EXISTS idx_shearing_events_occurred_at ON shearing_events (occurred_at);

CREATE TABLE IF NOT EXISTS treatments (
  id uuid PRIMARY KEY,
  tag text NOT NULL,
  type text NOT NULL CHECK (type IN ('vaccination', 'deworming')),
  medication text NOT NULL,
  dose text NOT NULL DEFAULT '',
  occurred_on date NOT NULL,
  recorded_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  deleted_at timestamptz,
  origin text NOT NULL DEFAULT 'unknown'
);
CREATE INDEX IF NOT EXISTS idx_treatments_tag ON treatments (tag);
CREATE INDEX IF NOT EXISTS idx_treatments_occurred_on ON treatments (occurred_on);

CREATE TABLE IF NOT EXISTS treatment_presets (
  id uuid PRIMARY KEY,
  type text NOT NULL,
  medication text NOT NULL,
  dose text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL,
  deleted_at timestamptz
);

CREATE TABLE IF NOT EXISTS devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  role text NOT NULL DEFAULT 'phone',
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz
);

ALTER TABLE shearing_events ADD COLUMN IF NOT EXISTS survey jsonb;

-- Latest shearing event per tag = current sheep status.
CREATE OR REPLACE VIEW sheep_latest AS
  SELECT DISTINCT ON (tag)
    tag, id, station, color, lactation, type, wool_quality, occurred_at
  FROM shearing_events
  WHERE deleted_at IS NULL
  ORDER BY tag, occurred_at DESC;

-- A transactional counter (not a sequence) orders committed shearing changes.
-- Its row lock prevents an older revision from committing after a newer cursor.
CREATE TABLE IF NOT EXISTS shearing_sync_clock (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton), revision bigint NOT NULL
);
INSERT INTO shearing_sync_clock VALUES (true, 0) ON CONFLICT DO NOTHING;
ALTER TABLE shearing_events ADD COLUMN IF NOT EXISTS revision bigint NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS shearing_audit (
  id bigserial PRIMARY KEY, row_id uuid NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL, before_row jsonb, after_row jsonb, dedupe text UNIQUE
);
CREATE INDEX IF NOT EXISTS idx_shearing_audit_row ON shearing_audit (row_id, id);
CREATE OR REPLACE FUNCTION record_shearing_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE shearing_sync_clock SET revision = revision + 1 WHERE singleton RETURNING revision INTO NEW.revision;
  RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION audit_shearing_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO shearing_audit(row_id, source, before_row, after_row)
    VALUES(NEW.id, COALESCE(NULLIF(current_setting('esquila.change_source', true), ''), 'ranch'),
      CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE NULL END, to_jsonb(NEW));
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS shearing_change ON shearing_events;
CREATE TRIGGER shearing_change BEFORE INSERT OR UPDATE ON shearing_events
  FOR EACH ROW EXECUTE FUNCTION record_shearing_change();
DROP TRIGGER IF EXISTS shearing_audit_change ON shearing_events;
CREATE TRIGGER shearing_audit_change AFTER INSERT OR UPDATE ON shearing_events
  FOR EACH ROW EXECUTE FUNCTION audit_shearing_change();
SELECT revision FROM shearing_sync_clock WHERE singleton FOR UPDATE;
UPDATE shearing_events SET revision = revision WHERE revision = 0;
CREATE INDEX IF NOT EXISTS idx_shearing_events_revision ON shearing_events (revision);

-- Cloud-only provenance: old origin strings are not reliable device identities.
-- Retain attribution after device revocation; never infer it for legacy rows.
CREATE TABLE IF NOT EXISTS shearing_record_servers (
  record_id uuid NOT NULL REFERENCES shearing_events(id),
  server_id uuid NOT NULL, server_name text NOT NULL,
  first_uploaded_at timestamptz, last_uploaded_at timestamptz,
  uploaded_updated_at timestamptz,
  PRIMARY KEY(record_id, server_id)
);
CREATE INDEX IF NOT EXISTS idx_shearing_record_servers_server ON shearing_record_servers(server_id, record_id);
CREATE INDEX IF NOT EXISTS idx_shearing_record_servers_uploaded ON shearing_record_servers(last_uploaded_at DESC);

CREATE TABLE IF NOT EXISTS ranch_status (
  device_id uuid PRIMARY KEY REFERENCES devices(id) ON DELETE CASCADE,
  received_at timestamptz NOT NULL DEFAULT now(), applied_revision bigint NOT NULL DEFAULT 0,
  information jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS admin_record_mutations (
  id text PRIMARY KEY, request jsonb NOT NULL, result jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS ranch_configurations (
  device_id uuid PRIMARY KEY REFERENCES devices(id) ON DELETE CASCADE,
  revision int NOT NULL CHECK (revision > 0), configuration jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  applied_revision int NOT NULL DEFAULT 0, checked_at timestamptz
);
CREATE TABLE IF NOT EXISTS ranch_configuration_history (
  device_id uuid NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  revision int NOT NULL, configuration jsonb NOT NULL, source text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(device_id, revision)
);
CREATE TABLE IF NOT EXISTS ranch_configuration_receipts (
  device_id uuid NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  id text NOT NULL, request jsonb NOT NULL, result jsonb NOT NULL,
  PRIMARY KEY(device_id, id)
);

-- Administrator identities are separate from phone/server device credentials.
CREATE TABLE IF NOT EXISTS admin_auth_state (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  initialized boolean NOT NULL DEFAULT false
);
INSERT INTO admin_auth_state(singleton) VALUES(true) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS admin_users (
  id uuid PRIMARY KEY, email text NOT NULL UNIQUE, name text NOT NULL,
  role text NOT NULL CHECK(role IN ('owner','admin')),
  status text NOT NULL CHECK(status IN ('invited','active','disabled')),
  password_hash text, created_at timestamptz NOT NULL DEFAULT now(),
  verified_at timestamptz, password_changed_at timestamptz, last_login_at timestamptz
);
CREATE TABLE IF NOT EXISTS admin_sessions (
  token_hash text PRIMARY KEY, user_id uuid REFERENCES admin_users(id),
  created_at timestamptz NOT NULL DEFAULT now(), last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS admin_sessions_user ON admin_sessions(user_id);
CREATE TABLE IF NOT EXISTS admin_action_tokens (
  token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES admin_users(id),
  purpose text NOT NULL CHECK(purpose IN ('invite','reset')),
  expires_at timestamptz NOT NULL, consumed_at timestamptz
);
CREATE TABLE IF NOT EXISTS admin_mail_jobs (
  id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES admin_users(id),
  token_hash text REFERENCES admin_action_tokens(token_hash), payload text,
  status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','sending','sent','failed','cancelled')),
  attempts int NOT NULL DEFAULT 0, next_attempt_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(), sent_at timestamptz
);
CREATE INDEX IF NOT EXISTS admin_mail_due ON admin_mail_jobs(status,next_attempt_at);
CREATE TABLE IF NOT EXISTS admin_auth_limits (
  key_hash text PRIMARY KEY, attempts int NOT NULL, reset_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS admin_security_audit (
  id bigserial PRIMARY KEY, actor_id uuid REFERENCES admin_users(id),
  subject_id uuid REFERENCES admin_users(id), event text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
