-- Shared places: one encrypted blob per place. Apply with:
--   npx wrangler d1 execute booked-spaces --remote --file=schema.sql
CREATE TABLE IF NOT EXISTS spaces (
  id TEXT PRIMARY KEY,
  version INTEGER NOT NULL,
  data TEXT NOT NULL,
  admin_hash TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
