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
