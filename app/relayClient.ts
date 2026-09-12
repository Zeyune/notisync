import * as SecureStore from "expo-secure-store";

import { myAddress } from "./pairingState";

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
 * Development default: the laptop running `wrangler dev` on the local network.
 *
 * This is a *stepping stone*, not the product — it still requires both devices
 * on one network, which is the very limitation M3 removes. It exists so M3.2 and
 * M3.3 can be built and tested before a Cloudflare account exists; **M3.4
 * replaces it with the deployed Worker URL**, and only then is the off-network
 * claim actually true.
 */
const DEFAULT_RELAY_URL = "http://192.168.1.11:8788";

let cachedSecret: string | null = null;
let cachedUrl: string | null = null;

export async function relayUrl(): Promise<string> {
  if (!cachedUrl) {
    cachedUrl = (await SecureStore.getItemAsync(RELAY_URL)) ?? DEFAULT_RELAY_URL;
  }
  return cachedUrl;
}

export async function setRelayUrl(url: string): Promise<void> {
  cachedUrl = url.trim().replace(/\/+$/, "");
  await SecureStore.setItemAsync(RELAY_URL, cachedUrl);
}

export async function deviceSecret(): Promise<string | null> {
  if (!cachedSecret) cachedSecret = await SecureStore.getItemAsync(DEVICE_SECRET);
  return cachedSecret;
}

export function isRegistered(): boolean {
  return cachedSecret !== null;
}

type RelayResult<T> = { ok: true; value: T } | { ok: false; error: string };

async function call<T>(
  path: string,
  init: { method?: string; body?: unknown; authenticated?: boolean } = {},
): Promise<RelayResult<T>> {
  const base = await relayUrl();
  const headers: Record<string, string> = {};
  if (init.body) headers["content-type"] = "application/json";

  if (init.authenticated !== false) {
    const secret = await deviceSecret();
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
      const message = (parsed as { error?: string })?.error ?? `HTTP ${response.status}`;
      return { ok: false, error: message };
    }
    return { ok: true, value: parsed as T };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      error: controller.signal.aborted ? "relay timed out after 10s" : message,
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
  const existing = await deviceSecret();

  const result = await call<{ secret?: string }>("/register", {
    method: "POST",
    body: { publicKey: myAddress(), fcmToken },
    authenticated: existing !== null,
  });

  if (!result.ok) return result;

  if (result.value.secret) {
    // Returned exactly once, when the address is first claimed. Stored in
    // Keystore/Keychain beside the identity (FR-3); it cannot be recovered from
    // the relay afterwards.
    cachedSecret = result.value.secret;
    await SecureStore.setItemAsync(DEVICE_SECRET, result.value.secret);
  }
  return { ok: true, value: true };
}

/** Hands a sealed envelope to the relay for delivery to `target`. */
export async function sendViaRelay(
  target: string,
  ciphertext: string,
): Promise<RelayResult<{ id: string }>> {
  return call<{ id: string }>("/send", {
    method: "POST",
    body: { target, ciphertext },
  });
}

/** FR-17's fetch path: collect ciphertext that was too large to ride the push. */
export async function fetchBlob(
  id: string,
): Promise<RelayResult<{ id: string; sender: string; ciphertext: string }>> {
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
export async function ackBlob(id: string): Promise<RelayResult<{ deleted: number }>> {
  return call<{ deleted: number }>("/ack", { method: "POST", body: { id } });
}
