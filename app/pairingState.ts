import { buildPairingPayload, deriveSessionKeys, generateIdentity } from "./pairing";
import type { Identity, PairingPayload } from "./pairing";
import type { SessionKeys } from "./pairingKeys";

/**
 * Where the pairing lives while the app is running — and only while it is.
 *
 * **FR-3 is not implemented.** The shared key is supposed to live in Android
 * Keystore or the iOS Keychain; here it lives in a module-level variable, so a
 * reload or a process death loses it and both devices must pair again. That is
 * acceptable for M2's first slice and unacceptable to ship: a receiver that
 * silently forgets its key would present as "notifications stopped arriving",
 * which is the single symptom FR-33's diagnostics screen exists to explain.
 *
 * Deliberately a module-level store rather than React state: `crypto.ts` needs
 * the send key from inside the notification listener callback, which is not a
 * React render path and has no access to context.
 */

let identity: Identity | null = null;
let sessionKeys: SessionKeys | null = null;
let peerDeviceId: string | null = null;

/**
 * This device's long-term identity, generated once per app run.
 *
 * Regenerated on every launch precisely because FR-3 storage is missing — there
 * is nowhere durable to keep the secret key, so pretending it is long-term would
 * be a lie the rest of the code would then rely on.
 */
export function myIdentity(): Identity {
  if (!identity) identity = generateIdentity();
  return identity;
}

/** The payload the other device needs — FR-1's QR contents, as plain text. */
export function myPairingPayload(deviceId: string): PairingPayload {
  return buildPairingPayload(deviceId, myIdentity().publicKey);
}

function fromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

export type PairResult =
  | { ok: true; fingerprint: string }
  | { ok: false; error: string };

/**
 * Completes FR-2 from a peer's pairing payload.
 *
 * Returns a short fingerprint of the derived keys so the two devices can be
 * compared by eye. That check matters more than it looks: if the derivation
 * disagreed across devices, every later symptom would be an AEAD authentication
 * failure at the far end, which points at the cipher rather than at pairing.
 * Comparing four bytes on two screens localises that in seconds.
 */
export function pairWith(raw: string): PairResult {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, error: "nothing entered" };

  let payload: PairingPayload;
  if (trimmed.startsWith("{")) {
    try {
      payload = JSON.parse(trimmed);
    } catch {
      return { ok: false, error: "not valid JSON" };
    }
  } else {
    // A bare base64url public key. FR-2 offers manual entry as the fallback for
    // an unusable camera, and nobody transcribing a code by hand is going to
    // type a JSON object — the QR path can carry the full payload, but the
    // human path has to accept the one field that matters.
    payload = { v: 1, deviceId: "manual", pk: trimmed, token: "" };
  }

  if (payload.v !== 1) {
    return { ok: false, error: `unsupported pairing version ${payload.v}` };
  }
  if (!payload.pk) return { ok: false, error: "no public key in payload" };

  let theirPublicKey: Uint8Array;
  try {
    theirPublicKey = fromBase64Url(payload.pk);
  } catch {
    return { ok: false, error: "public key is not valid base64url" };
  }
  if (theirPublicKey.length !== 32) {
    return { ok: false, error: `public key is ${theirPublicKey.length} bytes, expected 32` };
  }

  const me = myIdentity();
  sessionKeys = deriveSessionKeys(me.secretKey, me.publicKey, theirPublicKey);
  peerDeviceId = payload.deviceId;

  return { ok: true, fingerprint: fingerprintOf(sessionKeys) };
}

/**
 * Four bytes of each direction, rendered for on-screen comparison.
 *
 * Crosswise by construction: this device's `send` must equal the other's
 * `receive`. Showing both makes a mismatch obvious without needing to know which
 * device sorted first.
 */
function fingerprintOf(keys: SessionKeys): string {
  const hex = (bytes: Uint8Array) =>
    Array.from(bytes.slice(0, 4), (b) => b.toString(16).padStart(2, "0")).join("");
  return `send ${hex(keys.sendKey)} · recv ${hex(keys.receiveKey)}`;
}

export function currentPairing(): {
  paired: boolean;
  peerDeviceId: string | null;
  fingerprint: string | null;
} {
  return {
    paired: sessionKeys !== null,
    peerDeviceId,
    fingerprint: sessionKeys ? fingerprintOf(sessionKeys) : null,
  };
}

/** The key outgoing notifications are sealed with, or null when unpaired. */
export function sendKey(): Uint8Array | null {
  return sessionKeys?.sendKey ?? null;
}

/** FR-4's unpair, minus the persistence it will need once FR-3 exists. */
export function unpair(): void {
  sessionKeys = null;
  peerDeviceId = null;
}
