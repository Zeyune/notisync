/**
 * NotifSync relay (PRD §8, §10 M3).
 *
 * The server's job is deliberately tiny: hold device push tokens, relay opaque
 * blobs, forget them once delivered. It cannot decrypt anything — it holds no
 * private key and no derived session key — and §7 states exactly what it *can*
 * observe: device labels, push tokens, payload sizes, and timing. Every addition
 * to this file should be checked against that sentence before it is written.
 *
 * `/send` stores the ciphertext and then wakes the target with an FCM data
 * message (FR-16). Small payloads ride inline on the push; larger ones carry
 * only the blob id and the receiver collects them over HTTPS (FR-17).
 */

import { sendPush } from "./fcm";

export interface Env {
  DB: D1Database;
  BLOB_TTL_SECONDS: string;
  /** Firebase service-account JSON, set with `wrangler secret put`. */
  FCM_SERVICE_ACCOUNT: string;
}

/** X25519 public keys are 32 bytes, which is 43 base64url characters unpadded. */
const PUBLIC_KEY_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/**
 * Refuses payloads far larger than anything this product produces.
 *
 * Measured notification payloads at M1 were 232–476 bytes. 64 KB leaves room for
 * FR-17's oversized cases while making the relay useless as free general-purpose
 * storage — §9.3 names abuse, not adoption, as the cost risk.
 */
const MAX_CIPHERTEXT_BYTES = 64 * 1024;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomToken(byteLength: number): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(byteLength)));
}

/**
 * Compares two secrets without leaking their contents through timing.
 *
 * A plain `===` on a bearer token exits at the first differing byte, which over
 * many attempts reveals the token prefix by prefix. The cost of avoiding that is
 * a few microseconds.
 */
function secretsMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i += 1) {
    difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return difference === 0;
}

type DeviceRow = { public_key: string; secret: string; fcm_token: string | null };

/**
 * Resolves the caller from its bearer token.
 *
 * Returns null rather than throwing so each route decides its own failure
 * response, and every unauthenticated outcome is a plain 401 with no detail —
 * "no such device" and "wrong secret" must not be distinguishable, or the relay
 * becomes an oracle for which public keys are registered.
 */
async function authenticate(request: Request, env: Env): Promise<DeviceRow | null> {
  const header = request.headers.get("authorization") ?? "";
  const [scheme, token] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) return null;

  const publicKey = request.headers.get("x-device-key");
  if (!publicKey || !PUBLIC_KEY_PATTERN.test(publicKey)) return null;

  const row = await env.DB.prepare(
    "SELECT public_key, secret, fcm_token FROM devices WHERE public_key = ?",
  )
    .bind(publicKey)
    .first<DeviceRow>();

  if (!row || !secretsMatch(row.secret, token)) return null;
  return row;
}

/**
 * `POST /register` — claim an address, or update the push token for one held.
 *
 * The address is the device's X25519 public key, so nothing new is minted here;
 * pairing already distributes it. Registration is first-write-wins: whoever
 * claims a public key first receives the secret, and later callers must present
 * it. See the squatting limitation recorded in notification-sync-m3-plan.md.
 */
async function handleRegister(request: Request, env: Env): Promise<Response> {
  const body = (await request.json().catch(() => null)) as {
    publicKey?: string;
    fcmToken?: string;
  } | null;

  if (!body?.publicKey || !PUBLIC_KEY_PATTERN.test(body.publicKey)) {
    return json({ error: "publicKey must be a 43-character base64url X25519 key" }, 400);
  }

  const now = Math.floor(Date.now() / 1000);
  const existing = await env.DB.prepare(
    "SELECT public_key, secret, fcm_token FROM devices WHERE public_key = ?",
  )
    .bind(body.publicKey)
    .first<DeviceRow>();

  if (existing) {
    // Already claimed: only the holder of the secret may update the token.
    const caller = await authenticate(request, env);
    if (!caller || caller.public_key !== body.publicKey) {
      return json({ error: "unauthorized" }, 401);
    }
    await env.DB.prepare(
      "UPDATE devices SET fcm_token = ?, updated_at = ? WHERE public_key = ?",
    )
      .bind(body.fcmToken ?? existing.fcm_token, now, body.publicKey)
      .run();
    return json({ publicKey: body.publicKey, registered: true });
  }

  const secret = randomToken(32);
  await env.DB.prepare(
    "INSERT INTO devices (public_key, secret, fcm_token, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
  )
    .bind(body.publicKey, secret, body.fcmToken ?? null, now, now)
    .run();

  // The only time the secret is ever returned. It is stored on the device in
  // Keystore/Keychain (FR-3) and cannot be recovered from here.
  return json({ publicKey: body.publicKey, secret, registered: true }, 201);
}

/**
 * `POST /send` — hand the relay a sealed payload for another device.
 *
 * The relay never inspects `ciphertext`. It is stored verbatim and handed back
 * to the target, which is the only party able to open it.
 */
async function handleSend(request: Request, env: Env): Promise<Response> {
  const caller = await authenticate(request, env);
  if (!caller) return json({ error: "unauthorized" }, 401);

  const body = (await request.json().catch(() => null)) as {
    target?: string;
    ciphertext?: string;
  } | null;

  if (!body?.target || !PUBLIC_KEY_PATTERN.test(body.target)) {
    return json({ error: "target must be a 43-character base64url X25519 key" }, 400);
  }
  if (!body.ciphertext || typeof body.ciphertext !== "string") {
    return json({ error: "ciphertext is required" }, 400);
  }
  if (body.ciphertext.length > MAX_CIPHERTEXT_BYTES) {
    return json({ error: "ciphertext too large" }, 413);
  }

  const id = randomToken(16);
  await env.DB.prepare(
    "INSERT INTO blobs (id, target, sender, ciphertext, created_at) VALUES (?, ?, ?, ?, ?)",
  )
    .bind(id, body.target, caller.public_key, body.ciphertext, Math.floor(Date.now() / 1000))
    .run();

  const target = await env.DB.prepare("SELECT fcm_token FROM devices WHERE public_key = ?")
    .bind(body.target)
    .first<{ fcm_token: string | null }>();

  if (!target?.fcm_token) {
    // Stored but unreachable. Reported as 202 with a flag rather than an error:
    // the payload is safely held and FR-32 will expire it, and the sender should
    // not retry a send that succeeded. It is surfaced so an unregistered
    // receiver is visible rather than looking like successful delivery.
    return json({ id, pushed: false, reason: "target has no push token" }, 202);
  }

  // FCM caps a message at 4 KB. Measured payloads are 232-476 bytes, so almost
  // everything rides inline and the round trip to fetch it is avoided; the blob
  // stays stored regardless, so FR-17's fetch path works for the rest and an
  // interrupted receiver can still collect what it missed.
  const inline = body.ciphertext.length <= 2800;
  const push = await sendPush(env.FCM_SERVICE_ACCOUNT, target.fcm_token, {
    v: "1",
    id,
    ...(inline ? { p: body.ciphertext } : {}),
  });

  if (!push.ok) {
    if (push.tokenInvalid) {
      // The token will never work again; keeping it would fail every future
      // send in exactly the same silent way.
      await env.DB.prepare("UPDATE devices SET fcm_token = NULL WHERE public_key = ?")
        .bind(body.target)
        .run();
    }
    // Never log `push.error` verbatim: FCM echoes the registration token in some
    // error bodies, and §7 does not put an operator-readable device token in the
    // logs. The sender is told; the log is not.
    console.log(`push failed for a device (tokenInvalid=${push.tokenInvalid})`);
    return json({ id, pushed: false, reason: push.error }, 202);
  }

  return json({ id, pushed: true, inline }, 202);
}

/**
 * `GET /blob/:id` — the recipient collects its ciphertext (FR-17's fetch path).
 *
 * Only the target may read it. A blob addressed elsewhere reports 404 rather
 * than 403, so the relay does not confirm that an id exists to anyone who is not
 * entitled to it.
 */
async function handleFetch(id: string, request: Request, env: Env): Promise<Response> {
  const caller = await authenticate(request, env);
  if (!caller) return json({ error: "unauthorized" }, 401);

  const row = await env.DB.prepare(
    "SELECT id, target, sender, ciphertext FROM blobs WHERE id = ?",
  )
    .bind(id)
    .first<{ id: string; target: string; sender: string; ciphertext: string }>();

  if (!row || row.target !== caller.public_key) return json({ error: "not found" }, 404);

  return json({ id: row.id, sender: row.sender, ciphertext: row.ciphertext });
}

/**
 * `POST /ack` — FR-32's first deadline: delete on acknowledgement.
 *
 * Deleting only when the target asks is what keeps the relay's storage
 * transient by construction rather than by policy.
 */
async function handleAck(request: Request, env: Env): Promise<Response> {
  const caller = await authenticate(request, env);
  if (!caller) return json({ error: "unauthorized" }, 401);

  const body = (await request.json().catch(() => null)) as { id?: string } | null;
  if (!body?.id) return json({ error: "id is required" }, 400);

  const result = await env.DB.prepare("DELETE FROM blobs WHERE id = ? AND target = ?")
    .bind(body.id, caller.public_key)
    .run();

  // Idempotent: acknowledging an already-deleted blob is success, because a
  // receiver that retries an ack after a dropped response must not see an error.
  return json({ deleted: result.meta.changes ?? 0 });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === "POST" && path === "/register") {
      return handleRegister(request, env);
    }
    if (request.method === "POST" && path === "/send") {
      return handleSend(request, env);
    }
    if (request.method === "POST" && path === "/ack") {
      return handleAck(request, env);
    }
    if (request.method === "GET" && path.startsWith("/blob/")) {
      return handleFetch(path.slice("/blob/".length), request, env);
    }
    if (request.method === "GET" && path === "/health") {
      return json({ ok: true });
    }

    return json({ error: "not found" }, 404);
  },

  /**
   * FR-32's second deadline: 24 hours, for the receiver that never returned.
   *
   * Acknowledgement covers the normal case. This exists so that an undelivered
   * blob has a bounded life regardless — the retention figure stated in the
   * privacy policy has to be true even when nothing goes right.
   */
  async scheduled(_event: ScheduledEvent, env: Env): Promise<void> {
    const ttl = Number(env.BLOB_TTL_SECONDS) || 86400;
    const cutoff = Math.floor(Date.now() / 1000) - ttl;
    const result = await env.DB.prepare("DELETE FROM blobs WHERE created_at < ?")
      .bind(cutoff)
      .run();
    // Count only — never the ids or targets. §7's exposure list does not include
    // an operator-readable record of who was sent what, and logs are part of it.
    console.log(`swept ${result.meta.changes ?? 0} expired blobs`);
  },
};
