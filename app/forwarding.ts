import { seal } from "./crypto";
import { initPairing, myAddress, peerAddress } from "./pairingState";
import { relayUrl, sendViaRelay } from "./relayClient";
import { sendToReceiver } from "./lanForwarding";
import { deliveryDB, nextSequence, setDiagnostic } from "./deliveryStore";
import { retryDelay } from "./deliveryProtocol";
import type { ForwardedNotification } from "./deliveryProtocol";

export type Transport = "relay" | "lan";
export type ForwardResult = { ok: true; status: string } | { ok: false; error: string };
type Outgoing = { id: string; target: string; relay: string; ciphertext: string; attempt: number };
let enqueuing = Promise.resolve<unknown>(undefined);
let flushing: Promise<void> | null = null;

export function forwardNotification(
  build: (seq: number) => ForwardedNotification,
  transport: Transport,
  host: string,
): Promise<ForwardResult> {
  const work = enqueuing.then(async (): Promise<ForwardResult> => {
    try {
      await initPairing();
      const target = peerAddress();
      if (!target) return { ok: false, error: "pair the receiving device first" };
      const seq = await nextSequence(`${myAddress()}:${target}:${transport}`);
      const payload = build(seq);
      payload.id = `${myAddress()}:${target}:${transport}:${seq}`;
      if (transport === "lan") {
        const result = await sendToReceiver(host, payload);
        return result.ok ? { ok: true, status: "LAN accepted" } : result;
      }
      const envelope = await seal(payload);
      if (peerAddress() !== target) return { ok: false, error: "pairing changed while sending" };
      const base = await relayUrl();
      const db = await deliveryDB();
      await db.runAsync("INSERT INTO outbox(id, target, relay, ciphertext, created_at) VALUES (?, ?, ?, ?, ?)",
        payload.id, target, base, envelope.payload, Date.now());
      await flushOutbox();
      const queued = await db.getFirstAsync("SELECT id FROM outbox WHERE id = ?", payload.id);
      return { ok: true, status: queued ? "encrypted payload queued; retry pending" : "relay accepted; check receiver for delivery" };
    } catch { return { ok: false, error: "could not encrypt or persist outgoing notification" }; }
  });
  enqueuing = work.catch(() => undefined);
  return work;
}

/** Retries only transport failures. A 202 means stored, even if FCM failed. */
export function flushOutbox(): Promise<void> {
  if (flushing) return flushing;
  flushing = drainOutbox().finally(() => { flushing = null; });
  return flushing;
}

async function drainOutbox(): Promise<void> {
  await initPairing();
  const db = await deliveryDB();
  const expired = await db.runAsync("DELETE FROM outbox WHERE created_at < ?", Date.now() - 86400_000);
  if (expired.changes) await setDiagnostic("sender expired", `${expired.changes} queued notification(s)`);
  const rows = await db.getAllAsync<Outgoing>("SELECT id, target, relay, ciphertext, attempt FROM outbox WHERE next_attempt <= ? ORDER BY created_at LIMIT 20", Date.now());
  for (const row of rows) {
    if (row.target !== peerAddress()) {
      // Unpairing revokes forwarding, including queued envelopes for the old peer.
      await db.runAsync("DELETE FROM outbox WHERE id = ?", row.id);
      await setDiagnostic("sender", "discarded queue for revoked pairing");
      continue;
    }
    const result = await sendViaRelay(row.target, row.ciphertext, row.relay);
    if (result.ok) {
      await db.runAsync("DELETE FROM outbox WHERE id = ?", row.id);
      await setDiagnostic("sender", result.value.pushed ? "FCM accepted; receiver delivery unconfirmed" : "stored at relay; receiver unreachable or push failed");
    } else {
      await db.runAsync("UPDATE outbox SET attempt = attempt + 1, next_attempt = ? WHERE id = ?", Date.now() + retryDelay(row.attempt), row.id);
      await setDiagnostic("sender", `${result.error}; encrypted retry queued`);
      // Avoid multiplying ten-second timeouts during a network outage.
      break;
    }
  }
}
