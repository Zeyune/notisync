import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import worker from "../.verification/index.mjs";
import { sendPush } from "../.verification/fcm.mjs";

function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("./schema.sql", import.meta.url), "utf8"));
  const DB = { prepare(sql) {
    let args = [];
    return { bind(...values) { args = values; return this; },
      async first() { return db.prepare(sql).get(...args) ?? null; },
      async all() { return { results: db.prepare(sql).all(...args) }; },
      async run() { const result = db.prepare(sql).run(...args); return { meta: { changes: result.changes } }; },
    };
  } };
  const env = { DB, BLOB_TTL_SECONDS: "86400", FCM_SERVICE_ACCOUNT: "" };
  const call = async (path, body, key, secret) => {
    const headers = {};
    if (secret) { headers.authorization = `Bearer ${secret}`; headers["x-device-key"] = key; }
    if (body) headers["content-type"] = "application/json";
    const response = await worker.fetch(new Request(`https://relay.test${path}`, {
      method: body ? "POST" : "GET", headers, body: body ? JSON.stringify(body) : undefined,
    }), env);
    return { status: response.status, body: await response.json() };
  };
  return { db, call, env };
}
test("relay register/send/fetch/pending/ack authorizes recipient and retains only ciphertext", async () => {
  const f = fixture(), sender = randomBytes(32).toString("base64url"), target = randomBytes(32).toString("base64url");
  const a = await f.call("/register", { publicKey: sender });
  const b = await f.call("/register", { publicKey: target });
  assert.equal(a.status, 201); assert.equal(b.status, 201);
  assert.equal((await f.call("/register", { publicKey: sender })).status, 401);
  assert.equal((await f.call("/send", { target, ciphertext: "opaque" })).status, 401);
  const cipher = randomBytes(200).toString("base64");
  const sent = await f.call("/send", { target, ciphertext: cipher }, sender, a.body.secret);
  assert.equal(sent.status, 202); assert.equal(sent.body.pushed, false);
  const id = sent.body.id;
  assert.equal((await f.call(`/blob/${id}`, undefined, sender, a.body.secret)).status, 404);
  const fetched = await f.call(`/blob/${id}`, undefined, target, b.body.secret);
  assert.equal(fetched.body.ciphertext, cipher); assert.equal(fetched.body.sender, sender);
  assert.equal((await f.call("/pending")).status, 401);
  assert.equal((await f.call("/pending", undefined, sender, a.body.secret)).body.blobs.length, 0);
  assert.equal((await f.call("/pending", undefined, target, b.body.secret)).body.blobs.length, 1);
  assert.equal((await f.call("/ack", { id }, sender, a.body.secret)).body.deleted, 0);
  assert.equal((await f.call("/ack", { id }, target, b.body.secret)).body.deleted, 1);
  assert.equal((await f.call("/ack", { id }, target, b.body.secret)).body.deleted, 0);
  assert.equal((await f.call(`/blob/${id}`, undefined, target, b.body.secret)).status, 404);
  assert.equal((await f.call("/send", { target, ciphertext: "A".repeat(70000) }, sender, a.body.secret)).status, 413);
});
test("pending excludes expired blobs and scheduled sweep removes them", async () => {
  const f = fixture(), key = randomBytes(32).toString("base64url");
  const reg = await f.call("/register", { publicKey: key });
  f.db.prepare("INSERT INTO blobs VALUES (?, ?, ?, ?, ?)").run("expired", key, key, "opaque", 0);
  assert.equal((await f.call("/pending", undefined, key, reg.body.secret)).body.blobs.length, 0);
  await worker.scheduled({}, f.env);
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM blobs").get().n, 0);
});
test("FCM uses only data, high priority and bounded TTL; errors never echo token", async () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const account = JSON.stringify({ client_email: "qa@example.invalid", private_key: privateKey.export({ type: "pkcs8", format: "pem" }),
    project_id: "qa", token_uri: "https://oauth.test" });
  const original = globalThis.fetch;
  let status = 200, details = [], throwNetwork = false, sent;
  globalThis.fetch = async (url, init) => {
    if (url === "https://oauth.test") return Response.json({ access_token: "qa-oauth", expires_in: 3600 });
    if (throwNetwork) throw new Error("token-value-must-not-escape");
    sent = JSON.parse(init.body);
    return Response.json(status === 200 ? { name: "qa" } : { error: { message: "sensitive-registration-token", details } }, { status });
  };
  try {
    assert.deepEqual(await sendPush(account, "qa-token", { v: "1", id: "A".repeat(22), p: "opaque-ciphertext" }), { ok: true });
    assert.equal(sent.message.notification, undefined);
    assert.deepEqual(sent.message.android, { priority: "high", ttl: "86400s" });
    assert.deepEqual(sent.message.data, { v: "1", id: "A".repeat(22), p: "opaque-ciphertext" });
    status = 400; details = [{ "@type": "type.googleapis.com/google.firebase.fcm.v1.FcmError", errorCode: "INVALID_ARGUMENT" }];
    const malformed = await sendPush(account, "qa-token", {});
    assert.equal(malformed.tokenInvalid, false); assert.equal(malformed.error, "FCM HTTP 400");
    status = 404; details = [{ "@type": "type.googleapis.com/google.firebase.fcm.v1.FcmError", errorCode: "UNREGISTERED" }];
    assert.equal((await sendPush(account, "qa-token", {})).tokenInvalid, true);
    throwNetwork = true;
    assert.equal((await sendPush(account, "qa-token", {})).error, "FCM network failure");
  } finally { globalThis.fetch = original; }
});
