/**
 * End-to-end check of the relay's storage and authorisation rules.
 *
 * Exercises the full path a notification takes — register, send, fetch, ack —
 * plus the refusals that matter, because the interesting failures here are
 * authorisation ones and they are silent if nobody asserts on them. Runs against
 * `wrangler dev` or a deployed Worker.
 *
 *   node relay/smoke-test.mjs [baseUrl]
 */

import { randomBytes } from "node:crypto";

const BASE = process.argv[2] ?? "http://127.0.0.1:8788";

let failures = 0;

function check(name, condition, detail = "") {
  console.log(`${condition ? "  ✓" : "  ✗ FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!condition) failures += 1;
}

/** 32 random bytes as base64url — the shape of an X25519 public key. */
function fakePublicKey() {
  return randomBytes(32)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function call(path, { method = "GET", body, key, secret } = {}) {
  const headers = {};
  if (body) headers["content-type"] = "application/json";
  if (secret) {
    headers["authorization"] = `Bearer ${secret}`;
    headers["x-device-key"] = key;
  }
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* non-JSON body is itself a finding; leave parsed null */
  }
  return { status: response.status, body: parsed, raw: text };
}

console.log(`\nNotifSync relay smoke test — ${BASE}\n`);

const sender = fakePublicKey();
const receiver = fakePublicKey();

// --- registration -----------------------------------------------------------
const regSender = await call("/register", { method: "POST", body: { publicKey: sender } });
check("sender registers", regSender.status === 201, `status ${regSender.status}`);
check("registration returns a secret", typeof regSender.body?.secret === "string");
const senderSecret = regSender.body?.secret;

const regReceiver = await call("/register", {
  method: "POST",
  body: { publicKey: receiver, fcmToken: "fake-token-for-m3.1" },
});
const receiverSecret = regReceiver.body?.secret;
check("receiver registers", regReceiver.status === 201);

const badKey = await call("/register", { method: "POST", body: { publicKey: "too-short" } });
check("malformed public key is refused", badKey.status === 400);

// Re-registering a claimed address without the secret must not succeed, or
// anyone could hijack a device's push token by knowing its public key.
const squat = await call("/register", { method: "POST", body: { publicKey: sender } });
check("re-registering a claimed key without the secret is refused", squat.status === 401);

const legitUpdate = await call("/register", {
  method: "POST",
  body: { publicKey: sender, fcmToken: "updated-token" },
  key: sender,
  secret: senderSecret,
});
check("holder of the secret may update its token", legitUpdate.status === 200);

// --- send -------------------------------------------------------------------
const ciphertext = randomBytes(200).toString("base64");

const unauth = await call("/send", { method: "POST", body: { target: receiver, ciphertext } });
check("send without credentials is refused", unauth.status === 401);

const wrongSecret = await call("/send", {
  method: "POST",
  body: { target: receiver, ciphertext },
  key: sender,
  secret: "wrong-secret-entirely",
});
check("send with a wrong secret is refused", wrongSecret.status === 401);

const sent = await call("/send", {
  method: "POST",
  body: { target: receiver, ciphertext },
  key: sender,
  secret: senderSecret,
});
check("send is accepted", sent.status === 202, `status ${sent.status}`);
const blobId = sent.body?.id;
check("send returns a blob id", typeof blobId === "string");

const oversized = await call("/send", {
  method: "POST",
  body: { target: receiver, ciphertext: "A".repeat(70 * 1024) },
  key: sender,
  secret: senderSecret,
});
check("oversized payload is refused", oversized.status === 413);

// --- fetch ------------------------------------------------------------------
// The sender must not be able to read back what it sent. It already has the
// plaintext, so this is about the rule rather than the secret: a blob is
// readable only by its target.
const wrongReader = await call(`/blob/${blobId}`, { key: sender, secret: senderSecret });
check("a non-target cannot fetch the blob", wrongReader.status === 404);

const fetched = await call(`/blob/${blobId}`, { key: receiver, secret: receiverSecret });
check("target fetches the blob", fetched.status === 200, `status ${fetched.status}`);
check("ciphertext round-trips byte-for-byte", fetched.body?.ciphertext === ciphertext);
check("sender is identified to the recipient", fetched.body?.sender === sender);

// --- ack and deletion (FR-32) -----------------------------------------------
const wrongAck = await call("/ack", {
  method: "POST",
  body: { id: blobId },
  key: sender,
  secret: senderSecret,
});
check("a non-target cannot ack the blob away", wrongAck.body?.deleted === 0);

const acked = await call("/ack", {
  method: "POST",
  body: { id: blobId },
  key: receiver,
  secret: receiverSecret,
});
check("target acks the blob", acked.body?.deleted === 1);

const afterAck = await call(`/blob/${blobId}`, { key: receiver, secret: receiverSecret });
check("blob is gone after ack (FR-32)", afterAck.status === 404);

const reAck = await call("/ack", {
  method: "POST",
  body: { id: blobId },
  key: receiver,
  secret: receiverSecret,
});
check("acking twice is idempotent, not an error", reAck.status === 200);

console.log(
  failures === 0 ? "\nAll checks passed.\n" : `\n${failures} check(s) FAILED.\n`,
);
process.exit(failures === 0 ? 0 : 1);
