import {
  AESEncryptionKey,
  aesEncryptAsync,
} from "expo-crypto";

import { sendKey } from "./pairingState";

/**
 * M2 slice 1 — AEAD, without pairing yet.
 *
 * PRD §12 Q2 settles the stack: AES-256-GCM through `expo-crypto` on this side,
 * CryptoKit's `AES.GCM` in the iOS Notification Service Extension (FR-35), and
 * X25519 + HKDF at pairing time. This file is only the AEAD half. FR-1 and FR-2
 * — the QR exchange that produces a real shared key — come next, and until they
 * exist both ends use the fixed development key below.
 */

/**
 * ⚠ DEVELOPMENT KEY — PUBLIC, WORTHLESS, NEVER TO BE USED FOR ANYTHING REAL. ⚠
 *
 * This value is committed to a public GitHub repository, so anyone can read it
 * and decrypt anything it protects. It exists so the sender and the throwaway
 * laptop receiver can agree on a key before pairing is built, and for no other
 * purpose.
 *
 * It must be deleted — not rotated, not moved to a config file — when FR-2's key
 * exchange lands. A real key is generated per pairing, lives in Android Keystore
 * or the iOS Keychain (FR-3), and never appears in source, in a build artifact,
 * or on the relay. There is no key recovery by design (FR-27).
 *
 * The loudness of this comment is proportional to how ordinary a hardcoded key
 * looks six months later, in a file nobody is reading closely.
 */
const DEVELOPMENT_KEY_BASE64 = "PgZO+T2I2lS82EC/U2REy7DqjlD5LWgJtTtd5/dRmRw=";

/**
 * The envelope that actually crosses the network.
 *
 * Deliberately almost empty. PRD §7 states the relay sees ciphertext, a target
 * token and a size — nothing else — so every field of `ForwardedNotification`,
 * including the sequence number, goes *inside* the ciphertext rather than
 * beside it. The receiver decrypts before it can do anything at all, FR-26's
 * gap detection included.
 *
 * Leaving `seq` outside would have been convenient for the receiver and would
 * have handed the relay a per-device notification counter for free. Timing and
 * volume are already observable (§7); an explicit, ordered count is a stronger
 * signal, and under §1.1's financial use case it would count money events.
 */
export type Envelope = {
  /** Format version. A receiver that does not recognise it must refuse, not guess. */
  v: 1;
  /** Base64 of AES-GCM `IV ‖ ciphertext ‖ tag` — expo-crypto's `combined()`. */
  payload: string;
};

let cachedKey: AESEncryptionKey | null = null;
let cachedKeyFor: string | null = null;

function keyIdentity(bytes: Uint8Array | null): string {
  if (!bytes) return "development";
  // Only an identity for the cache, never logged or transmitted.
  return Array.from(bytes.slice(0, 8), (b) => b.toString(16)).join("");
}

/**
 * The key to seal with: the paired send key if there is one, else the fixed
 * development key.
 *
 * The fallback is what makes this runnable before pairing exists, and it is also
 * the dangerous part — an unpaired device encrypts with a key published on
 * GitHub while the UI says "encrypted". `App.tsx` states which key is in use for
 * exactly that reason. When FR-2 pairing is mandatory, this fallback is deleted
 * rather than kept as a convenience.
 */
async function activeKey(): Promise<AESEncryptionKey> {
  const derived = sendKey();
  const identity = keyIdentity(derived);

  // Importing is not free, and the key changes only when pairing does.
  if (!cachedKey || cachedKeyFor !== identity) {
    cachedKey = derived
      ? await AESEncryptionKey.import(derived)
      : await AESEncryptionKey.import(DEVELOPMENT_KEY_BASE64, "base64");
    cachedKeyFor = identity;
  }
  return cachedKey;
}

/**
 * Encrypts an object into an `Envelope`.
 *
 * The 12-byte IV is generated per message by `expo-crypto` rather than supplied
 * here, which is the safe default: GCM fails catastrophically on nonce reuse,
 * and a nonce this code chose would be a nonce this code could get wrong. §8's
 * separate-key-per-direction rule exists for the same reason at a larger scale —
 * two devices encrypting under one key could collide on a nonce — and that rule
 * is not yet implemented, because it needs the pairing this file predates.
 */
export async function seal(value: unknown): Promise<Envelope> {
  const key = await activeKey();

  // TextEncoder, not btoa: notification bodies carry non-ASCII — a peso sign is
  // the obvious one under §1.1 — and btoa throws on anything outside Latin-1.
  const plaintext = new TextEncoder().encode(JSON.stringify(value));

  const sealed = await aesEncryptAsync(plaintext, key);
  const payload = (await sealed.combined("base64")) as string;

  return { v: 1, payload };
}
