import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import { x25519 } from "@noble/curves/ed25519.js";
import { deriveSessionKeys } from "./pairingKeys.ts";
import { createReceiver, decodeCiphertext, parseRelayMessage, retryDelay, validateNotification } from "./deliveryProtocol.ts";
import type { ReceiverDependencies, ForwardedNotification } from "./deliveryProtocol.ts";
import { DELIVERY_SCHEMA, NEXT_SEQUENCE_SQL, FIND_RECEIPT_SQL, GAP_COUNT_SQL } from "./deliverySql.ts";

const message = { id: "QA-1", seq: 1, sourceApp: "QA", title: "M3 QA", body: "₱100 ✓", timestamp: 1, deviceLabel: "Samsung QA" };
function fixture(overrides: Partial<ReceiverDependencies> = {}) {
  const a = randomBytes(32), b = randomBytes(32);
  const apk = x25519.getPublicKey(a), bpk = x25519.getPublicKey(b);
  const sending = deriveSessionKeys(a, apk, bpk).sendKey;
  const receiving = deriveSessionKeys(b, bpk, apk).receiveKey;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", sending, iv);
  const ciphertext = Buffer.concat([iv, cipher.update(JSON.stringify(message), "utf8"), cipher.final(), cipher.getAuthTag()]).toString("base64");
  const db = new DatabaseSync(":memory:");
  db.exec(DELIVERY_SCHEMA);
  const events: string[] = [];
  const deps: ReceiverDependencies = {
    peer: async () => "paired-sender",
    fetch: async () => ({ sender: "paired-sender", ciphertext }),
    decrypt: async payload => {
      const bytes = Buffer.from(decodeCiphertext(payload));
      const decipher = createDecipheriv("aes-256-gcm", receiving, bytes.subarray(0, 12));
      decipher.setAuthTag(bytes.subarray(-16));
      return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(12, -16)), decipher.final()]).toString("utf8"));
    },
    canDisplay: async () => true,
    findReceipt: async (sender, id, seq) => db.prepare(FIND_RECEIPT_SQL).get(sender, id, seq) as any ?? null,
    display: async n => { assert.equal(n.body, message.body); events.push("display"); },
    saveReceipt: async (sender, n) => { db.prepare("INSERT INTO receipts VALUES (?, ?, ?, ?)").run(sender, n.id, n.seq, Date.now()); events.push("receipt"); },
    queueAck: async id => { db.prepare("INSERT OR IGNORE INTO pending_acks VALUES (?, ?)").run(id, "https://qa"); events.push("queue-ack"); },
    acknowledge: async () => { events.push("ack"); return true; },
    finishAck: async id => { db.prepare("DELETE FROM pending_acks WHERE id = ?").run(id); },
    ...overrides,
  };
  return { receive: createReceiver(deps), db, events, ciphertext, push: { v: "1" as const, id: "A".repeat(22), p: ciphertext } };
}

test("paired Android wire format: authenticate, display, persist, then ack", async () => {
  const f = fixture();
  assert.equal(await f.receive(f.push), "displayed");
  assert.deepEqual(f.events, ["display", "receipt", "queue-ack", "ack"]);
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM pending_acks").get()!.n, 0);
});

test("Android sealed-data input is decoded bytes with intact IV/ciphertext/tag", async () => {
  const f = fixture();
  const bytes = decodeCiphertext(f.ciphertext);
  assert.ok(bytes instanceof Uint8Array);
  assert.deepEqual(Buffer.from(bytes), Buffer.from(f.ciphertext, "base64"));
  assert.throws(() => decodeCiphertext("invalid"), /invalid encrypted envelope/);
  assert.equal(await f.receive(f.push), "displayed");
});
test("concurrent duplicate pushes and retried sends display once", async () => {
  const f = fixture();
  assert.deepEqual(await Promise.all([f.receive(f.push), f.receive(f.push), f.receive({ ...f.push, id: "B".repeat(22) })]), ["displayed", "duplicate", "duplicate"]);
  assert.equal(f.events.filter(e => e === "display").length, 1);
  assert.equal(f.events.filter(e => e === "ack").length, 3);
});
test("ack failure keeps receipt and pending ack; duplicate retries only ack", async () => {
  const f = fixture({ acknowledge: async () => false });
  assert.equal(await f.receive(f.push), "displayed");
  assert.equal(await f.receive(f.push), "duplicate");
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM pending_acks").get()!.n, 1);
  assert.equal(f.events.filter(e => e === "display").length, 1);
});
test("denied permission/channel and absent pairing retain the relay blob", async () => {
  for (const overrides of [{ canDisplay: async () => false }, { peer: async () => null }]) {
    const f = fixture(overrides);
    assert.equal(await f.receive(f.push), "blocked");
    assert.deepEqual(f.events, []);
  }
});
test("tampering fails authenticated decryption, without display or acknowledgement", async () => {
  const f = fixture();
  const tampered = Buffer.from(f.ciphertext, "base64"); tampered[15] ^= 1;
  assert.equal(await f.receive({ ...f.push, p: tampered.toString("base64") }), "rejected");
  assert.deepEqual(f.events, []);
});
test("fetch-only pushes verify the authenticated sender", async () => {
  const f = fixture();
  assert.equal(await f.receive({ v: "1", id: f.push.id }), "displayed");
  const wrong = fixture({ fetch: async () => ({ sender: "other-device", ciphertext: f.ciphertext }) });
  assert.equal(await wrong.receive({ v: "1", id: f.push.id }), "rejected");
  assert.deepEqual(wrong.events, []);
});
test("native display failure does not save a receipt or ack", async () => {
  const f = fixture({ display: async () => { throw new Error("blocked"); } });
  assert.equal(await f.receive(f.push), "failed");
  assert.deepEqual(f.events, []);
});
test("bad payloads and reused sequences are rejected", async () => {
  assert.throws(() => validateNotification({ ...message, key: "private-account-identifier" }));
  assert.throws(() => validateNotification({ ...message, seq: 1.5 }));
  assert.throws(() => validateNotification({ ...message, body: {} }));
  const f = fixture({ findReceipt: async () => ({ notificationId: "different-id", seq: 1 }) });
  assert.equal(await f.receive(f.push), "rejected");
});
test("SDK 57 native data keys and Expo JSON data normalize; unrelated pushes ignored", () => {
  const f = fixture();
  for (const value of [f.push, { data: f.push }, { data: { dataString: JSON.stringify(f.push) } }]) {
    assert.deepEqual(parseRelayMessage(value), f.push);
  }
  for (const value of [null, {}, { v: "2", id: f.push.id }, { ...f.push, p: "plaintext" }, { data: { dataString: "{" } }]) {
    assert.equal(parseRelayMessage(value), null);
  }
});
test("persistent per-pair sequence SQL and reordering-aware gap detection", () => {
  const db = new DatabaseSync(":memory:"); db.exec(DELIVERY_SCHEMA);
  const next = db.prepare(NEXT_SEQUENCE_SQL);
  assert.equal(next.get("a:b")!.seq, 1); assert.equal(next.get("a:b")!.seq, 2);
  assert.equal(next.get("a:c")!.seq, 1);
  const save = db.prepare("INSERT INTO receipts VALUES (?, ?, ?, ?)");
  save.run("a", "first", 5, 0); save.run("a", "last", 7, 0);
  assert.equal(db.prepare(GAP_COUNT_SQL).get()!.n, 1);
  save.run("a", "late", 6, 0);
  assert.equal(db.prepare(GAP_COUNT_SQL).get()!.n, 0);
  assert.throws(() => save.run("a", "reused", 6, 0));
  assert.equal(retryDelay(0), 1000); assert.equal(retryDelay(30), 60000);
});
