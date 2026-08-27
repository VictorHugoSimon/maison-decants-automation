PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS stores (
  store_id INTEGER PRIMARY KEY,
  access_token_ciphertext TEXT,
  scopes TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  installed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS webhook_events (
  event_id TEXT PRIMARY KEY,
  store_id INTEGER NOT NULL,
  event_name TEXT NOT NULL,
  entity_id TEXT,
  payload_json TEXT NOT NULL,
  received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at TEXT,
  processing_status TEXT NOT NULL DEFAULT 'received',
  error_message TEXT,
  FOREIGN KEY (store_id) REFERENCES stores(store_id)
);

CREATE INDEX IF NOT EXISTS idx_webhook_events_store_received
  ON webhook_events(store_id, received_at DESC);

CREATE TABLE IF NOT EXISTS entity_snapshots (
  store_id INTEGER NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  synced_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (store_id, entity_type, entity_id),
  FOREIGN KEY (store_id) REFERENCES stores(store_id)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id INTEGER,
  action TEXT NOT NULL,
  status TEXT NOT NULL,
  details TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_audit_log_store_created
  ON audit_log(store_id, created_at DESC);
