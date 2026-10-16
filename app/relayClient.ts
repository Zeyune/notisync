import * as SecureStore from "expo-secure-store";
import { sha256 } from "@noble/hashes/sha2.js";

import { initPairing, myAddress } from "./pairingState";

/**
 * Talks to the NotifSync relay (PRD §8, §10 M3).
 *
 * The relay replaces M1's LAN POST so a notification reaches the other phone
 * from anywhere — §1 names LAN-only operation as the specific reason KDE Connect
 * fails, and it is the gap M3 exists to close.
 *
 * Nothing here ever sees plaintext: callers hand it an already-sealed envelope
 * from `crypto.ts`. That ordering is deliberate — encryption happens before the
 * transport layer is reached, so no code path here can leak content even by
 * mistake.
 */

const RELAY_URL = "notifsync.v1.relay.url";
const DEVICE_SECRET = "notifsync.v1.relay.secret";

/**
 * The deployed relay.
 *
 * HTTPS and publicly routable, which is what makes the off-network claim real:
 * the sender no longer needs to share a network with the receiver, or with this
 * laptop. It also removed a whole class of local problems — Windows Firewall was
 * silently dropping inbound connections to `wrangler dev` on 8788, and a LAN
 * address changes with DHCP.
 *
 * Overridable per device via the Relay card, which is how a self-hosted relay
 * (§12 Q3, answered as "both") will be pointed at without a rebuild.
 */
const DEFAULT_RELAY_URL = "https://notifsync-relay.johnkenneth-tan-dev.workers.dev";

let cachedUrl: string | null = null;
const registrations = new Map<string, Promise<RelayResult<true>>>();

async function secretKey(base: string): Promise<string> {
  await initPairing();
  const digest = sha256(new TextEncoder().encode(`${base}:${myAddress()}`));
  return `${DEVICE_SECRET}.${Array.from(digest, b => b.toString(16).padStart(2, "0")).join("")}`;
}

export async function relayUrl(): Promise<string> {
  if (!cachedUrl) {
    cachedUrl = (await SecureStore.getItemAsync(RELAY_URL)) ?? DEFAULT_RELAY_URL;
  }
  return cachedUrl;
}

export async function setRelayUrl(url: string): Promise<void> {
  const parsed = new URL(url.trim());
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && ["localhost", "127.0.0.1"].includes(parsed.hostname))) {
    throw new Error("relay must use HTTPS");
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== "/") {
    throw new Error("enter only the relay's HTTPS origin");
  }
  await SecureStore.setItemAsync(RELAY_URL, parsed.origin);
  cachedUrl = parsed.origin;
}

export async function deviceSecret(base?: string): Promise<string | null> {
  const url = base ?? await relayUrl();
  const key = await secretKey(url);
  let secret = await SecureStore.getItemAsync(key);
  // Preserve the existing Samsung registration. Never send this legacy secret
  // to a different relay; new registrations are scoped to origin + identity.
  if (!secret && url === DEFAULT_RELAY_URL) {
    secret = await SecureStore.getItemAsync(DEVICE_SECRET);
    if (secret) await SecureStore.setItemAsync(key, secret);
  }
  return secret;
}

export type RelayResult<T> = { ok: true; value: T } | { ok: false; error: string; status?: number };
export type SendResponse = { id: string; pushed: boolean; inline?: boolean; reason?: string };
export type BlobResponse = { id: string; sender: string; ciphertext: string };

async function call<T>(
  path: string,
  init: { method?: string; body?: unknown; authenticated?: boolean; base?: string } = {},
): Promise<RelayResult<T>> {
  await initPairing();
  const base = init.base ?? await relayUrl();
  const headers: Record<string, string> = {};
  if (init.body) headers["content-type"] = "application/json";

  if (init.authenticated !== false) {
    const secret = await deviceSecret(base);
    if (!secret) return { ok: false, error: "device is not registered with the relay" };
    headers["authorization"] = `Bearer ${secret}`;
    headers["x-device-key"] = myAddress();
  }

  // Same reasoning as the LAN sender: without a timeout a wrong or unreachable
  // relay address hangs on the platform default, and the UI reports nothing for
  // over a minute — which reads as "capture is broken" rather than "that address
  // is wrong".
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);

  try {
    const response = await fetch(`${base}${path}`, {
      method: init.method ?? "GET",
      headers,
      body: init.body ? JSON.stringify(init.body) : undefined,
      signal: controller.signal,
    });

    const text = await response.text();
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { ok: false, error: `relay returned non-JSON (HTTP ${response.status})` };
    }

    if (!response.ok) {
      // An older relay can echo FCM token values in error bodies. Never expose
      // server-provided text to UI/logs, including parse and transport failures.
      return { ok: false, error: `relay HTTP ${response.status}`, status: response.status };
    }
    return { ok: true, value: parsed as T };
  } catch (e) {
    return {
      ok: false,
      error: controller.signal.aborted ? "relay timed out after 10s" : "relay connection failed",
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Claims this device's relay address and reports its push token.
 *
 * Safe to call repeatedly: the first call claims the address and returns a
 * secret, later calls authenticate with it and refresh the token. FCM tokens
 * rotate — on app reinstall, data clear, or at Google's discretion — so this
 * runs on every launch rather than once at setup.
 */
export async function registerWithRelay(fcmToken: string | null): Promise<RelayResult<true>> {
  await initPairing();
  const base = await relayUrl();
  const key = await secretKey(base);
  const previous = registrations.get(key);
  const registration = (previous ?? Promise.resolve()).then(() => performRegistration(fcmToken, base, key));
  registrations.set(key, registration);
  try { return await registration; }
  finally { if (registrations.get(key) === registration) registrations.delete(key); }
}

async function performRegistration(fcmToken: string | null, base: string, key: string): Promise<RelayResult<true>> {
  const existing = await deviceSecret(base);

  const result = await call<{ secret?: string }>("/register", {
    method: "POST",
    body: { publicKey: myAddress(), fcmToken },
    authenticated: existing !== null,
    base,
  });

  if (!result.ok) return result;

  if (result.value.secret) {
    // Returned exactly once, when the address is first claimed. Stored in
    // Keystore/Keychain beside the identity (FR-3); it cannot be recovered from
    // the relay afterwards.
    await SecureStore.setItemAsync(key, result.value.secret);
  }
  return { ok: true, value: true };
}

/** Hands a sealed envelope to the relay for delivery to `target`. */
export async function sendViaRelay(
  target: string,
  ciphertext: string,
  base?: string,
): Promise<RelayResult<SendResponse>> {
  return call<SendResponse>("/send", {
    method: "POST",
    body: { target, ciphertext },
    base,
  });
}

/** FR-17's fetch path: collect ciphertext that was too large to ride the push. */
export async function fetchBlob(
  id: string,
): Promise<RelayResult<BlobResponse>> {
  return call(`/blob/${id}`);
}

/**
 * FR-32: tells the relay the payload is safely handled, so it can be deleted.
 *
 * Called only after the notification has been decrypted and displayed. Acking
 * earlier would be convenient and wrong — a crash between ack and display would
 * lose the notification with no trace, which is precisely the silent failure
 * FR-26 and FR-33 exist to make impossible.
 */
export async function ackBlob(id: string, base?: string): Promise<RelayResult<{ deleted: number }>> {
  return call<{ deleted: number }>("/ack", { method: "POST", body: { id }, base });
}

export async function pendingBlobs(): Promise<RelayResult<{ blobs: BlobResponse[] }>> {
  return call("/pending");
}
