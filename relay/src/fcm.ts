/**
 * Sends FCM pushes from the relay using the HTTP v1 API.
 *
 * FR-16 delivers over platform push so the receiver is woken even when the app
 * is killed. This is the Android half; iOS/APNs is deferred with the rest of the
 * iOS receiver (see notification-sync-m3-plan.md).
 *
 * The legacy FCM server-key API is gone, so authentication means minting a
 * short-lived OAuth access token: build a JWT, sign it with the service
 * account's RSA key, and exchange it at Google's token endpoint. Workers has no
 * Node crypto, so the signing is done with Web Crypto.
 */

type ServiceAccount = {
  client_email: string;
  private_key: string;
  project_id: string;
  token_uri: string;
};

/**
 * Cached access token, per isolate.
 *
 * Google issues these with an hour's life. Minting one costs an RSA signature
 * plus a round trip to Google, which would otherwise be paid on **every
 * forwarded notification** — under a chatty sender that is the dominant cost of
 * delivery, and it is pure waste.
 */
let cachedToken: { value: string; expiresAt: number } | null = null;

function base64UrlEncode(bytes: Uint8Array | string): string {
  const binary =
    typeof bytes === "string"
      ? bytes
      : Array.from(bytes, (b) => String.fromCharCode(b)).join("");
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** PEM → DER, so Web Crypto can import the key. */
function pemToArrayBuffer(pem: string): ArrayBuffer {
  const body = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s+/g, "");
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function accessToken(account: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  // 60s of slack: a token that expires mid-flight fails the send, and the cost
  // of refreshing slightly early is one extra mint per hour.
  if (cachedToken && cachedToken.expiresAt > now + 60) return cachedToken.value;

  const header = base64UrlEncode(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = base64UrlEncode(
    JSON.stringify({
      iss: account.client_email,
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud: account.token_uri,
      iat: now,
      exp: now + 3600,
    }),
  );

  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(account.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(`${header}.${claim}`),
  );
  const jwt = `${header}.${claim}.${base64UrlEncode(new Uint8Array(signature))}`;

  const response = await fetch(account.token_uri, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });

  if (!response.ok) {
    throw new Error(`token exchange failed: HTTP ${response.status} ${await response.text()}`);
  }

  const body = (await response.json()) as { access_token: string; expires_in: number };
  cachedToken = { value: body.access_token, expiresAt: now + body.expires_in };
  return body.access_token;
}

export type PushOutcome =
  | { ok: true }
  | { ok: false; error: string; tokenInvalid: boolean };

/**
 * Wakes the target device with a **data-only** message.
 *
 * Data-only, not a notification message, and that is architectural rather than
 * stylistic: a notification message is rendered by the system before any of our
 * code runs, which would display raw ciphertext to the user. A data message
 * hands the payload to the app, which decrypts and then posts a local
 * notification — the Android counterpart of FR-35's Notification Service
 * Extension on iOS.
 *
 * `priority: high` is required for delivery while the device is in Doze;
 * normal-priority data messages are batched until the device wakes, which for a
 * notification relay is indistinguishable from not delivering at all.
 */
export async function sendPush(
  serviceAccountJson: string,
  fcmToken: string,
  data: Record<string, string>,
): Promise<PushOutcome> {
  let account: ServiceAccount;
  try {
    account = JSON.parse(serviceAccountJson);
  } catch {
    return { ok: false, error: "FCM_SERVICE_ACCOUNT is not valid JSON", tokenInvalid: false };
  }

  let token: string;
  try {
    token = await accessToken(account);
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      tokenInvalid: false,
    };
  }

  const response = await fetch(
    `https://fcm.googleapis.com/v1/projects/${account.project_id}/messages:send`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        message: {
          token: fcmToken,
          data,
          android: { priority: "high" },
        },
      }),
    },
  );

  if (response.ok) return { ok: true };

  const text = await response.text();
  // 404 UNREGISTERED / 400 INVALID_ARGUMENT on the token mean this device can
  // never be reached with it again. Distinguished from transient failures so the
  // caller can drop the stale token instead of retrying it forever — a stale
  // token otherwise fails silently, which is the one outcome FR-25 and FR-33
  // exist to prevent.
  const tokenInvalid =
    response.status === 404 ||
    (response.status === 400 && text.includes("INVALID_ARGUMENT"));

  return { ok: false, error: `FCM HTTP ${response.status}: ${text}`, tokenInvalid };
}
