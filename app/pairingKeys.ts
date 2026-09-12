import { x25519 } from "@noble/curves/ed25519.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";

/**
 * The pure half of FR-2's key exchange — no Expo, no React Native, no I/O.
 *
 * Split out from `pairing.ts` for one reason: it can then be imported and tested
 * under plain Node, which is how both sides of a pairing were proven to derive
 * identical keys without a second phone existing yet. Anything that touches
 * `expo-crypto` (randomness, QR payloads) stays in `pairing.ts`.
 */

const SHARED_KEY_BYTES = 32;

export type SessionKeys = {
  /** Encrypt outgoing notifications with this. */
  sendKey: Uint8Array;
  /** Decrypt incoming notifications with this. */
  receiveKey: Uint8Array;
};

/**
 * Compares two public keys bytewise, to give the pair a canonical order.
 *
 * Both devices must agree on which direction is "first" without negotiating it,
 * because there is no channel to negotiate over — each side holds only its own
 * secret and the peer's public key. Sorting the two public keys is deterministic
 * and identical on both sides, so each device works out its own role alone.
 */
function comparePublicKeys(a: Uint8Array, b: Uint8Array): number {
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * `@noble/hashes` v2 requires `info` and `salt` as bytes and rejects strings
 * outright — it does not silently coerce, which is the right call for a KDF.
 */
const utf8 = new TextEncoder();

/**
 * Derives both directional keys from an X25519 exchange.
 *
 * §8 requires a separate key per direction so the two devices can never collide
 * on a nonce. AES-GCM fails catastrophically on nonce reuse — not weakened
 * confidentiality but recoverable plaintext and forgeable messages — and two
 * devices independently choosing random 12-byte nonces under one shared key is
 * precisely that risk. Two keys make the collision impossible rather than
 * improbable.
 *
 * The raw X25519 output is never used as a key. It is a curve point rather than
 * uniformly random bytes, so it goes through HKDF first — that is what HKDF's
 * extract step exists for, and skipping it is a classic quiet mistake.
 *
 * Both public keys are bound into the salt and the info strings, so a derived
 * key is valid only for the exact pair that produced it.
 */
export function deriveSessionKeys(
  ourSecretKey: Uint8Array,
  ourPublicKey: Uint8Array,
  theirPublicKey: Uint8Array,
): SessionKeys {
  const shared = x25519.getSharedSecret(ourSecretKey, theirPublicKey);

  const weAreFirst = comparePublicKeys(ourPublicKey, theirPublicKey) < 0;
  const first = weAreFirst ? ourPublicKey : theirPublicKey;
  const second = weAreFirst ? theirPublicKey : ourPublicKey;

  const salt = new Uint8Array(first.length + second.length);
  salt.set(first, 0);
  salt.set(second, first.length);

  const label = `notifsync:v1:${toHex(first)}:${toHex(second)}`;
  const firstToSecond = hkdf(
    sha256,
    shared,
    salt,
    utf8.encode(`${label}:1->2`),
    SHARED_KEY_BYTES,
  );
  const secondToFirst = hkdf(
    sha256,
    shared,
    salt,
    utf8.encode(`${label}:2->1`),
    SHARED_KEY_BYTES,
  );

  return weAreFirst
    ? { sendKey: firstToSecond, receiveKey: secondToFirst }
    : { sendKey: secondToFirst, receiveKey: firstToSecond };
}
