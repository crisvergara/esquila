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
