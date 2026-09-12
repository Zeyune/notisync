/**
 * Proves the two sides of a pairing derive the same keys — without two phones.
 *
 * FR-2 says both devices "complete a key exchange so both hold a shared
 * symmetric key", and §8 requires a **separate key per direction**. Those two
 * requirements interact in a way that is easy to get subtly wrong and very hard
 * to debug on real hardware: if the two devices disagree about which direction
 * is which, pairing appears to succeed, encryption appears to succeed, and every
 * message fails to decrypt at the far end with an authentication error that
 * points at the AEAD rather than at the derivation.
 *
 * The derivation is deterministic and needs no I/O, so it can be checked here in
 * full. `pairingKeys.ts` is deliberately free of Expo imports so this can run.
 *
 *   cd app && node --experimental-strip-types pairingKeys.selftest.mts
 */

import { x25519 } from "@noble/curves/ed25519.js";
import { randomBytes } from "node:crypto";
import { deriveSessionKeys } from "./pairingKeys.ts";

let failures = 0;

function check(name: string, condition: boolean) {
  console.log(`${condition ? "  ✓" : "  ✗ FAIL"} ${name}`);
  if (!condition) failures += 1;
}

function same(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, i) => byte === b[i]);
}

function device() {
  const secretKey = new Uint8Array(randomBytes(32));
  return { secretKey, publicKey: x25519.getPublicKey(secretKey) };
}

console.log("\nFR-2 / §8 key derivation\n");

// Run repeatedly: which device sorts "first" depends on random key bytes, so a
// single run exercises only one of the two branches. Ten runs make it
// overwhelmingly likely both were taken — a bug in one branch would otherwise
// pass half the time, which is the worst way for a test to fail.
for (let round = 0; round < 10; round += 1) {
  const alice = device();
  const bob = device();

  const a = deriveSessionKeys(alice.secretKey, alice.publicKey, bob.publicKey);
  const b = deriveSessionKeys(bob.secretKey, bob.publicKey, alice.publicKey);

  if (round === 0) {
    check("Alice's send key matches Bob's receive key", same(a.sendKey, b.receiveKey));
    check("Bob's send key matches Alice's receive key", same(b.sendKey, a.receiveKey));
    check("the two directions use different keys (§8)", !same(a.sendKey, a.receiveKey));
    check("keys are 32 bytes", a.sendKey.length === 32);
  } else if (!same(a.sendKey, b.receiveKey) || !same(b.sendKey, a.receiveKey)) {
    check(`round ${round}: keys agree`, false);
  }
}
check("keys agree across 10 random pairs (both sort orders)", failures === 0);

// A key derived with one peer must not work with another. Without the public
// keys bound into the salt and info, a shared secret could be replayed against a
// different device.
const alice = device();
const bob = device();
const mallory = device();
const withBob = deriveSessionKeys(alice.secretKey, alice.publicKey, bob.publicKey);
const withMallory = deriveSessionKeys(alice.secretKey, alice.publicKey, mallory.publicKey);
check("a different peer yields different keys", !same(withBob.sendKey, withMallory.sendKey));

// Determinism: same inputs, same outputs. HKDF must not be salted with anything
// ambient, or two runs on the same device would disagree.
const repeat = deriveSessionKeys(alice.secretKey, alice.publicKey, bob.publicKey);
check("derivation is deterministic", same(withBob.sendKey, repeat.sendKey));

console.log(
  failures === 0
    ? "\nAll checks passed.\n"
    : `\n${failures} check(s) FAILED.\n`,
);
process.exit(failures === 0 ? 0 : 1);
