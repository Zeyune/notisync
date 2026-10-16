export const DELIVERY_SCHEMA = `
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS counters (pair TEXT PRIMARY KEY, seq INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS outbox (
  id TEXT PRIMARY KEY, target TEXT NOT NULL, relay TEXT NOT NULL,
  ciphertext TEXT NOT NULL, created_at INTEGER NOT NULL,
  attempt INTEGER NOT NULL DEFAULT 0, next_attempt INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS receipts (
  sender TEXT NOT NULL, notification_id TEXT NOT NULL, seq INTEGER NOT NULL,
  received_at INTEGER NOT NULL, PRIMARY KEY(sender, notification_id), UNIQUE(sender, seq)
);
CREATE TABLE IF NOT EXISTS pending_acks (id TEXT PRIMARY KEY, relay TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS diagnostics (name TEXT PRIMARY KEY, value TEXT NOT NULL);
`;
export const NEXT_SEQUENCE_SQL = "INSERT INTO counters(pair, seq) VALUES (?, 1) ON CONFLICT(pair) DO UPDATE SET seq = seq + 1 RETURNING seq";
export const FIND_RECEIPT_SQL = "SELECT notification_id AS notificationId, seq FROM receipts WHERE sender = ? AND (notification_id = ? OR seq = ?) LIMIT 1";
export const GAP_COUNT_SQL = "SELECT COALESCE(SUM(gaps), 0) AS n FROM (SELECT MAX(seq) - MIN(seq) + 1 - COUNT(*) AS gaps FROM receipts GROUP BY sender)";
