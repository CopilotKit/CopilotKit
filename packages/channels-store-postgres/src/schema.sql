CREATE TABLE IF NOT EXISTS cpk_state_kv (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  expires_at timestamptz
);

CREATE TABLE IF NOT EXISTS cpk_state_list (
  key text NOT NULL,
  seq bigserial PRIMARY KEY,
  value jsonb NOT NULL,
  expires_at timestamptz
);
CREATE INDEX IF NOT EXISTS cpk_state_list_key ON cpk_state_list(key, seq);

CREATE TABLE IF NOT EXISTS cpk_state_queue (
  key text NOT NULL,
  seq bigserial PRIMARY KEY,
  value jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS cpk_state_queue_key ON cpk_state_queue(key, seq);
