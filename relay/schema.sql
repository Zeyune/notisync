-- NotifSync relay — D1 schema (PRD §7, §10 M3)
--
-- The relay's job is deliberately tiny: hold device push tokens, relay opaque
-- blobs, forget them once delivered. Everything here is shaped by §7's promise
-- that the server sees "ciphertext, a target device token, and a size — nothing
-- else", so any column added later has to be justified against that sentence.

-- A device that can be sent to.
--
-- `public_key` is the device's X25519 public key, base64url — the same value
-- pairing already exchanges. Using it as the address means no second identifier
-- exists, and a sender that has paired already knows where to send. It is public
-- by definition and gives the relay no ability to decrypt anything.
CREATE TABLE IF NOT EXISTS devices (
  public_key TEXT PRIMARY KEY,
  -- Bearer token issued at registration, proving control of this address.
  -- First-write-wins: see the squatting limitation in notification-sync-m3-plan.md.
  secret     TEXT NOT NULL,
  -- Raw FCM registration token. Null until the device reports one.
  fcm_token  TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Ciphertext in transit, held only until acknowledged.
--
-- **There is deliberately no `seq` column.** The sequence number lives *inside*
-- the ciphertext (see app/crypto.ts), so the relay cannot keep an ordered
-- per-device count of a user's notifications. Adding it here would be
-- convenient for delivery bookkeeping and would quietly undo that decision —
-- under §1.1's financial use case, that counter would count money events.
CREATE TABLE IF NOT EXISTS blobs (
  id         TEXT PRIMARY KEY,
  -- Recipient's public key. Not a foreign key: a blob may be written for a
  -- device that has not yet registered a push token, and it should wait rather
  -- than be rejected.
  target     TEXT NOT NULL,
  sender     TEXT NOT NULL,
  -- base64 of AES-GCM `IV ‖ ciphertext ‖ tag`. Opaque here, always.
  ciphertext TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- FR-32 sweeps by age; delivery looks up by recipient.
CREATE INDEX IF NOT EXISTS blobs_created_at ON blobs (created_at);
CREATE INDEX IF NOT EXISTS blobs_target     ON blobs (target);
