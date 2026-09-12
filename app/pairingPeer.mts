/**
 * Stands in for a second device during pairing, so FR-2 can be exercised
 * against real hardware with only one phone.
 *
 * Give it the phone's public key (printed to logcat by `PairingCard`) and it
 * prints two things: a pairing payload to type into the phone, and the
 * fingerprint the phone must display once it pairs.
 *
 * The check it enables is cross-implementation, which is the point. The phone
 * derives with `@noble` under Hermes; this derives with the same source under
 * Node. Agreement means the derivation does not depend on the runtime — and a
 * disagreement would otherwise surface much later as an AEAD authentication
 * failure at the far end, pointing at the cipher instead of at pairing.
 *
 *   node --experimental-strip-types pairingPeer.mts <phone-public-key-base64url>
 */

import { x25519 } from "@noble/curves/ed25519.js";
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { deriveSessionKeys } from "./pairingKeys.ts";

/**
 * Where the derived receive key is left for the receiver to pick up.
 *
 * Without this the peer's secret key dies with the process, and a phone that has
 * just paired can encrypt nothing the laptop can read — the keys agree, and the
 * receiver still holds the old development key. Writing the one key the receiver
 * needs keeps the manual typing to a single round.
 *
 * Gitignored, and worthless anyway: it is a session key for a throwaway pairing
 * against a development peer.
 */
const SESSION_FILE = "../tools/peer-session.json";

const theirPkBase64Url = process.argv[2];
if (!theirPkBase64Url) {
  console.error("usage: node --experimental-strip-types pairingPeer.mts <public-key>");
  process.exit(1);
}

function fromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  return new Uint8Array(Buffer.from(padded, "base64"));
}

function toBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function hex4(bytes: Uint8Array): string {
  return Array.from(bytes.slice(0, 4), (b) => b.toString(16).padStart(2, "0")).join("");
}

const theirPublicKey = fromBase64Url(theirPkBase64Url);
if (theirPublicKey.length !== 32) {
  console.error(`public key is ${theirPublicKey.length} bytes, expected 32`);
  process.exit(1);
}

const secretKey = new Uint8Array(randomBytes(32));
const publicKey = x25519.getPublicKey(secretKey);

const mine = deriveSessionKeys(secretKey, publicKey, theirPublicKey);

console.log("\nPaste this into the phone's pairing field:\n");
console.log(
  JSON.stringify({
    v: 1,
    deviceId: "node-peer",
    pk: toBase64Url(publicKey),
    token: toBase64Url(new Uint8Array(randomBytes(16))),
  }),
);

// Crosswise: this peer's send key is the phone's receive key, and vice versa.
console.log("\nThe phone must then display exactly:\n");
console.log(`  send ${hex4(mine.receiveKey)} · recv ${hex4(mine.sendKey)}\n`);

// The receiver decrypts what the phone sends, so it needs this peer's *receive*
// key — which is the phone's send key.
writeFileSync(
  new URL(SESSION_FILE, import.meta.url),
  `${JSON.stringify(
    {
      note: "Throwaway M2 session key for the development peer. Not a secret worth keeping.",
      receiveKey: Buffer.from(mine.receiveKey).toString("base64"),
      peerPublicKey: toBase64Url(publicKey),
      phonePublicKey: theirPkBase64Url,
      createdAt: new Date().toISOString(),
    },
    null,
    2,
  )}\n`,
);
console.log(`Wrote the receiver's key to tools/peer-session.json`);
console.log("Restart the receiver to pick it up.\n");
