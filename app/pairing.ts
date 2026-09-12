import { x25519 } from "@noble/curves/ed25519.js";
import { getRandomBytes } from "expo-crypto";

export { deriveSessionKeys } from "./pairingKeys";
export type { SessionKeys } from "./pairingKeys";

/**
 * FR-1 / FR-2 — QR pairing, the parts that need the platform.
 *
 * PRD §12 Q2 settles the stack: X25519 through `@noble/curves`, HKDF through
 * `@noble/hashes`, both pure TypeScript with no native module. That rests on
 * call frequency — this runs twice in a pairing's entire life, where pure JS
 * costs nothing measurable and removes native-fork risk, while AEAD runs per
 * notification and stays native (see `crypto.ts`).
 *
 * The derivation itself lives in `pairingKeys.ts` so it can be tested under
 * Node. This file holds what cannot: randomness and the QR payload.
 *
 * Nothing here writes to Android Keystore or the iOS Keychain yet — FR-3 storage
 * is still to come, and until it lands, derived keys live only in memory.
 */

const SECRET_KEY_BYTES = 32;

export type Identity = {
  /** Never leaves the device, never enters a QR code. */
  secretKey: Uint8Array;
  /** Goes in the QR code (FR-1). Public by design. */
  publicKey: Uint8Array;
};

/**
 * Generates this device's long-term X25519 identity.
 *
 * Randomness comes from `expo-crypto`'s `getRandomBytes`, not noble's own
 * `utils.randomSecretKey()`. Noble reaches for `globalThis.crypto.getRandomValues`,
 * which is not reliably present under Hermes without a polyfill — and a silent
 * fall back to weak randomness during key generation is the worst failure this
 * file could have. An X25519 secret key is just 32 random bytes, so taking them
 * from a platform CSPRNG costs nothing and removes the question entirely.
 */
export function generateIdentity(): Identity {
  const secretKey = getRandomBytes(SECRET_KEY_BYTES);
  return { secretKey, publicKey: x25519.getPublicKey(secretKey) };
}

/**
 * What the QR code carries (FR-1): device ID, public key, pairing token.
 *
 * The token is short-lived and exists for freshness, not secrecy — it stops a
 * photographed QR from staying usable indefinitely. It is **not** what makes the
 * exchange safe; X25519 over a code the user physically shows to their own
 * second device is what does that.
 */
export type PairingPayload = {
  v: 1;
  deviceId: string;
  /** Base64url X25519 public key. */
  pk: string;
  /** Short-lived pairing token. */
  token: string;
};

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  // btoa is safe here: every byte above was mapped to a Latin-1 code point.
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function buildPairingPayload(
  deviceId: string,
  publicKey: Uint8Array,
): PairingPayload {
  return {
    v: 1,
    deviceId,
    pk: toBase64Url(publicKey),
    token: toBase64Url(getRandomBytes(16)),
  };
}
