import {
  AESEncryptionKey,
  AESSealedData,
  aesDecryptAsync,
  aesEncryptAsync,
} from "expo-crypto";

import { initPairing, sendKey, receiveKey } from "./pairingState";
import { decodeCiphertext, validCiphertext, validateNotification } from "./deliveryProtocol";
import type { ForwardedNotification } from "./deliveryProtocol";

/**
 * Paired AES-256-GCM encryption and authenticated receiver decryption.
 *
 * PRD §12 Q2 settles the stack: AES-256-GCM through `expo-crypto` on this side,
 * CryptoKit's `AES.GCM` in the iOS Notification Service Extension (FR-35), and
 * X25519 + HKDF at pairing time. Unpaired sends are refused.
 */

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
  if (!bytes) throw new Error("pair a receiver before forwarding");
  // Only an identity for the cache, never logged or transmitted.
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Imports only the paired send key; the cache never leaves this process. */
async function activeKey(): Promise<AESEncryptionKey> {
  await initPairing();
  const derived = sendKey();
  const identity = keyIdentity(derived);

  // Importing is not free, and the key changes only when pairing does.
  if (!cachedKey || cachedKeyFor !== identity) {
    if (!derived) throw new Error("pair a receiver before forwarding");
    cachedKey = await AESEncryptionKey.import(derived);
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
 * is implemented by pairingKeys.ts.
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

/** AES-GCM verifies the tag before returning plaintext. No unpaired fallback. */
export async function open(ciphertext: string): Promise<ForwardedNotification> {
  await initPairing();
  const derived = receiveKey();
  if (!derived || !validCiphertext(ciphertext)) throw new Error("cannot decrypt notification");
  try {
    const key = await AESEncryptionKey.import(derived);
    // The installed Android implementation takes ByteArray even though the
    // public TS signature also advertises strings. Decode before the bridge.
    const sealed = AESSealedData.fromCombined(decodeCiphertext(ciphertext), { ivLength: 12, tagLength: 16 });
    const bytes = await aesDecryptAsync(sealed, key);
    return validateNotification(JSON.parse(new TextDecoder().decode(bytes)));
  } catch { throw new Error("notification authentication or format failed"); }
}
