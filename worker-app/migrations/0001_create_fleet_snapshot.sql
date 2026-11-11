CREATE TABLE IF NOT EXISTS fleet_snapshots (
  id TEXT PRIMARY KEY CHECK (id = 'main'),
  snapshot TEXT NOT NULL CHECK (json_valid(snapshot)),
  updated_at TEXT NOT NULL
);
