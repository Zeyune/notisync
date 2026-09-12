import { x25519 } from "@noble/curves/ed25519.js";
import * as SecureStore from "expo-secure-store";

import { buildPairingPayload, deriveSessionKeys, generateIdentity } from "./pairing";
import type { Identity, PairingPayload } from "./pairing";
import type { SessionKeys } from "./pairingKeys";

/**
 * FR-3 — the identity and the pairing, kept in Android Keystore / iOS Keychain.
 *
 * `expo-secure-store` is FR-3 as written: on Android it encrypts values with a
 * Keystore-backed key, on iOS it writes to the Keychain. That second half also
 * matters for FR-35, because the Keychain **access group** is how the
 * Notification Service Extension will read this key without the app running.
 *
 * What is stored is the X25519 *secret key* and the peer's *public* key, not the
 * derived session keys. The session keys are recomputed on load, so there is one
 * source of truth and no way for a stored derivation to drift out of step with
 * the code that produced it. Re-deriving costs one scalar multiplication at
 * startup.
 *
 * FR-27 still holds: nothing here leaves the device and nothing can recover it.
 * Uninstalling, or clearing app data, destroys the pairing permanently and both
 * devices must pair again.
 */

// Namespaced so a future second pairing (v2, §11) does not collide.
const IDENTITY_SECRET = "notifsync.v1.identity.secret";
const PEER_PUBLIC = "notifsync.v1.peer.public";
const PEER_DEVICE_ID = "notifsync.v1.peer.deviceId";

let identity: Identity | null = null;
let sessionKeys: SessionKeys | null = null;
let peerDeviceId: string | null = null;
/** The peer's base64url public key — also its relay address (M3). */
let storedPeerPublic: string | null = null;
let ready = false;

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
}

function fromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  return fromBase64(padded + "=".repeat((4 - (padded.length % 4)) % 4));
}

/**
 * Loads the identity and any stored pairing, generating an identity on first run.
 *
 * Must be awaited before anything else here is used. The alternative — lazily
 * generating an identity the first time it is asked for — is what the in-memory
 * version did, and it silently produced a *new* device identity whenever module
 * state was lost, which looked like the pairing spontaneously breaking.
 */
export async function initPairing(): Promise<void> {
  if (ready) return;

  const storedSecret = await SecureStore.getItemAsync(IDENTITY_SECRET);
  if (storedSecret) {
    const secretKey = fromBase64(storedSecret);
    // Public key is derived rather than stored: it is a pure function of the
    // secret, and storing both invites them to disagree.
    const { publicKey } = identityFromSecret(secretKey);
    identity = { secretKey, publicKey };
  } else {
    identity = generateIdentity();
    await SecureStore.setItemAsync(IDENTITY_SECRET, toBase64(identity.secretKey));
  }

  const storedPeer = await SecureStore.getItemAsync(PEER_PUBLIC);
  if (storedPeer) {
    sessionKeys = deriveSessionKeys(
      identity.secretKey,
      identity.publicKey,
      fromBase64Url(storedPeer),
    );
    storedPeerPublic = storedPeer;
    peerDeviceId = await SecureStore.getItemAsync(PEER_DEVICE_ID);
  }

  ready = true;
}

/**
 * Public key is derived from the stored secret rather than stored alongside it:
 * it is a pure function of the secret, and keeping both invites them to
 * disagree after a partial write.
 */
function identityFromSecret(secretKey: Uint8Array): Identity {
  return { secretKey, publicKey: x25519.getPublicKey(secretKey) };
}

function requireIdentity(): Identity {
  if (!identity) {
    throw new Error("initPairing() must be awaited before using pairing state");
  }
  return identity;
}

export function isReady(): boolean {
  return ready;
}

/** The payload the other device needs — FR-1's QR contents, as plain text. */
export function myPairingPayload(deviceId: string): PairingPayload {
  return buildPairingPayload(deviceId, requireIdentity().publicKey);
}

function toBase64Url(bytes: Uint8Array): string {
  return toBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * This device's address on the relay (M3).
 *
 * The relay addresses devices by X25519 public key rather than minting an id of
 * its own, so a paired sender already knows where to send — the pairing exchange
 * distributed this exact value. The key is public by definition and gives the
 * relay no ability to decrypt.
 */
export function myAddress(): string {
  return toBase64Url(requireIdentity().publicKey);
}

/** The paired peer's relay address, or null when unpaired. */
export function peerAddress(): string | null {
  return storedPeerPublic;
}

export type PairResult =
  | { ok: true; fingerprint: string }
  | { ok: false; error: string };

/**
 * Completes FR-2 from a peer's pairing payload, and persists it.
 *
 * Returns a short fingerprint of the derived keys so the two devices can be
 * compared by eye. That check matters more than it looks: if the derivation
 * disagreed across devices, every later symptom would be an AEAD authentication
 * failure at the far end, which points at the cipher rather than at pairing.
 * Comparing four bytes on two screens localises it in seconds.
 */
export async function pairWith(raw: string): Promise<PairResult> {
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

  const me = requireIdentity();
  sessionKeys = deriveSessionKeys(me.secretKey, me.publicKey, theirPublicKey);
  peerDeviceId = payload.deviceId;
  storedPeerPublic = payload.pk;

  // Stored only after the derivation succeeds, so a rejected payload cannot
  // leave a half-written pairing behind.
  await SecureStore.setItemAsync(PEER_PUBLIC, payload.pk);
  await SecureStore.setItemAsync(PEER_DEVICE_ID, payload.deviceId);

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

/**
 * FR-4's unpair. Revokes this side of the pairing permanently.
 *
 * The identity is deliberately kept: this device stays itself, it simply has no
 * peer. Destroying the identity too would also be defensible, but it would
 * silently invalidate any *other* pairing once §11's multi-device support
 * exists, so the narrower action is the safer default.
 */
export async function unpair(): Promise<void> {
  sessionKeys = null;
  peerDeviceId = null;
  storedPeerPublic = null;
  await SecureStore.deleteItemAsync(PEER_PUBLIC);
  await SecureStore.deleteItemAsync(PEER_DEVICE_ID);
}
