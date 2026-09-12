/**
 * M1 LAN receiver — a throwaway stand-in for the receiving phone.
 *
 * PRD §10 M1 calls for two devices. This is a laptop instead, deliberately:
 * M1 exists to validate the `ForwardedNotification` shape (§7) before M2 wraps
 * it in AEAD and M3 puts a relay behind it, and a terminal validates that today
 * without a second device, a second build, or a pairing flow. Swapping in the
 * real Android receiver afterwards changes the transport, not the shape.
 *
 * All of this is thrown away at M3. Do not grow features here.
 *
 * Zero dependencies by design — `node tools/m1-receiver.mjs` and nothing else.
 *
 *   node tools/m1-receiver.mjs [port]
 */

import { createServer } from "node:http";
import { createDecipheriv } from "node:crypto";
import { readFileSync } from "node:fs";

/**
 * ⚠ DEVELOPMENT KEY — PUBLIC AND WORTHLESS. Mirrors app/crypto.ts. ⚠
 *
 * Committed to a public repository on purpose: it lets the sender and this
 * throwaway receiver agree on a key before FR-2's pairing exists. Both copies
 * get deleted when the QR exchange lands.
 */
const DEVELOPMENT_KEY = Buffer.from(
  "PgZO+T2I2lS82EC/U2REy7DqjlD5LWgJtTtd5/dRmRw=",
  "base64",
);

/**
 * Prefers a real paired key over the development one.
 *
 * `app/pairingPeer.mts` writes the key it derived when standing in as a second
 * device. Once the phone has paired, it seals with its derived send key and the
 * development key stops working — so reading this file is what lets the receiver
 * follow a pairing instead of being cut off by it.
 *
 * Absent means nobody has paired yet, which is the normal starting state rather
 * than an error.
 */
function activeKey() {
  try {
    const session = JSON.parse(
      readFileSync(new URL("./peer-session.json", import.meta.url), "utf8"),
    );
    const key = Buffer.from(session.receiveKey, "base64");
    if (key.length !== 32) throw new Error(`key is ${key.length} bytes`);
    console.log("Using the paired session key from tools/peer-session.json");
    return key;
  } catch {
    console.log("No pairing found — using the public development key");
    return DEVELOPMENT_KEY;
  }
}

const KEY = activeKey();

const IV_BYTES = 12;
const TAG_BYTES = 16;

/**
 * Opens an `expo-crypto` envelope using Node's own AES-256-GCM.
 *
 * This function is the point of the exercise, not a convenience. PRD §12 Q2
 * records that `expo-crypto`'s `combined()` layout matching CryptoKit's
 * `AES.GCM.SealedBox` rests on both vendors' documentation agreeing, never on a
 * measured round trip — and the real CryptoKit test needs a Mac, which this
 * project does not have until M3.
 *
 * Node is the available stand-in, and a meaningful one: it implements standard
 * AES-256-GCM with no knowledge of Expo or Apple. If a payload sealed on the
 * phone opens here, then `combined()` really is `IV ‖ ciphertext ‖ tag` with a
 * 12-byte IV and a 16-byte tag, which is exactly what CryptoKit consumes. That
 * does not *prove* CryptoKit will open it — only a Mac proves that — but it
 * converts the claim from "two documents agree" into "a third implementation
 * agrees", which is where most of the risk was.
 */
function open(envelope) {
  if (envelope.v !== 1) {
    throw new Error(`unknown envelope version ${envelope.v} — refusing to guess`);
  }

  const combined = Buffer.from(envelope.payload, "base64");
  if (combined.length < IV_BYTES + TAG_BYTES) {
    throw new Error(`payload too short: ${combined.length} bytes`);
  }

  const iv = combined.subarray(0, IV_BYTES);
  const tag = combined.subarray(combined.length - TAG_BYTES);
  const ciphertext = combined.subarray(IV_BYTES, combined.length - TAG_BYTES);

  const decipher = createDecipheriv("aes-256-gcm", KEY, iv);
  decipher.setAuthTag(tag);
  // `final()` throws if the tag does not verify — that is the authentication in
  // authenticated encryption, and it must never be caught and ignored.
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

  return JSON.parse(plaintext.toString("utf8"));
}

const PORT = Number(process.argv[2] ?? 8787);

/**
 * Highest sequence number seen per sender device (FR-26).
 *
 * The sender numbers every forwarded notification consecutively, so a gap here
 * means a notification left the sender and never arrived. That is the single
 * measurement M5's 72-hour soak test is built on, and it costs nothing to start
 * collecting now — on a LAN with no relay, *any* gap is a real defect rather
 * than the network being the network.
 */
const lastSeq = new Map();

/**
 * Sequence numbers not yet seen, below the highest one that has arrived.
 *
 * Tracking only the maximum is not enough, and the first real run proved it:
 * the sender fires each POST without awaiting the previous one — deliberately,
 * since awaiting would apply backpressure to capture — so two notifications
 * captured milliseconds apart race and can finish out of order. On 2026-09-12
 * seq 61 arrived after seq 62, and a maximum-only detector called it a loss.
 * Twice.
 *
 * That distinction is the whole point of FR-26. Gap counts are what M5's
 * 72-hour soak test measures, and that measurement decides whether a foreground
 * service ships at all — so a detector that reports reordering as loss would
 * make a healthy run look broken and argue for a service nobody needs. It gets
 * worse at M3, where FCM guarantees no ordering whatsoever.
 *
 * So: a skipped number is *outstanding*, not lost. It is only lost if it never
 * turns up, which is a question that can only be answered at the end.
 */
const outstanding = new Map();
let received = 0;
let reordered = 0;

const server = createServer((req, res) => {
  if (req.method !== "POST" || req.url !== "/notify") {
    res.writeHead(404).end("expected POST /notify\n");
    return;
  }

  let raw = "";
  req.on("data", (chunk) => {
    raw += chunk;
  });

  req.on("end", () => {
    let payload;
    try {
      payload = open(JSON.parse(raw));
    } catch (e) {
      console.error(`  ✗ could not open envelope: ${e.message}`);
      res.writeHead(400).end("bad envelope\n");
      return;
    }

    report(payload, raw.length);
    // Acknowledge only after printing. FR-32 deletes on acknowledgement, so the
    // habit of not acking before the payload is safely handled starts here.
    res.writeHead(200).end("ok\n");
  });
});

function report(n, bytes) {
  received += 1;

  const device = n.deviceLabel ?? "unknown device";
  if (!outstanding.has(device)) outstanding.set(device, new Set());
  const pending = outstanding.get(device);

  if (pending.delete(n.seq)) {
    // Arrived after a higher number did. Not a loss — the sender's concurrent
    // POSTs finished out of order.
    reordered += 1;
    console.log(`  ↻ out of order: seq ${n.seq} arrived late (not lost)`);
  }

  const previous = lastSeq.get(device);
  if (previous !== undefined && n.seq > previous + 1) {
    for (let missing = previous + 1; missing < n.seq; missing += 1) {
      pending.add(missing);
    }
  }

  if (previous === undefined || n.seq > previous) lastSeq.set(device, n.seq);

  const at = new Date(n.timestamp).toLocaleTimeString();

  /**
   * Time from the notification being posted to it arriving here.
   *
   * This is *not* a pure latency measurement, and printing it as one was
   * misleading: it spans two machines' clocks, so it carries their skew. The
   * A52 was observed running 10-20ms ahead of this laptop, which rendered as a
   * negative "latency". Signed output makes the skew visible instead of
   * dressing it up as a plus sign in front of a negative number.
   *
   * It matters beyond cosmetics. Q6's per-app TTL has the receiver decide
   * whether a notification is too stale to show, by comparing the sender's
   * timestamp to its own clock — exactly this subtraction. At 15ms it is noise;
   * at minutes of drift it would discard live notifications or present dead
   * ones as current, with no signal that a clock was the cause.
   */
  const lag = Date.now() - n.timestamp;
  const lagLabel = lag < 0 ? `${lag}ms (clock skew)` : `+${lag}ms`;

  console.log(
    `\n[${received}] seq=${n.seq} ${device} · ${bytes}B · ${lagLabel}\n` +
      `  ${n.sourceApp} · ${at}\n` +
      `  ${n.title ?? "(no title)"}\n` +
      `  ${n.body ?? "(no body)"}`,
  );

  // The one assertion worth making automatically. PRD §7 states that
  // StatusBarNotification.key must never leave the device, because app tags
  // embed Google account IDs and per-conversation identifiers. The sender is
  // built so this cannot happen; this check is what notices if that ever stops
  // being true, rather than trusting it silently.
  if ("key" in n) {
    console.error(
      "  ✗ §7 VIOLATION: payload contains `key` — stop and fix the sender",
    );
  }
}

/**
 * The only honest moment to call a notification lost.
 *
 * Mid-run, a missing sequence number is indistinguishable from one still in
 * flight. Reporting at shutdown is what separates FR-26's real measurement —
 * "these never arrived" — from the noise of ordinary concurrency.
 */
process.on("SIGINT", () => {
  console.log(`\n\n── session summary ──`);
  console.log(`received:  ${received}`);
  console.log(`reordered: ${reordered} (arrived late, not lost)`);

  let lost = 0;
  for (const [device, pending] of outstanding) {
    if (pending.size === 0) continue;
    lost += pending.size;
    const seqs = [...pending].sort((a, b) => a - b).join(", ");
    console.log(`LOST from ${device}: ${pending.size} — seq ${seqs}`);
  }
  if (lost === 0) console.log(`lost:      0 ✓`);

  process.exit(0);
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`M1 receiver listening on http://0.0.0.0:${PORT}/notify`);
  console.log("Point the sender at this machine's LAN IP. Ctrl+C to stop.\n");
});
