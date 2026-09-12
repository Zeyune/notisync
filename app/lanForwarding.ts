import type { CapturedNotification } from "./modules/notification-listener";

/**
 * The M1 wire format — what actually leaves the device.
 *
 * These are exactly the `ForwardedNotification` fields from PRD §7, and the
 * point of M1 is to find out whether they are the right ones *before* M2 wraps
 * them in AEAD and M3 puts a relay behind them. A missing field is trivial to
 * add now and expensive once it is inside an encrypted payload and a push
 * pipeline.
 *
 * Two absences are deliberate and load-bearing:
 *
 * `key` — PRD §7 states that `StatusBarNotification.key` must never leave the
 * device. App tags embed identifiers: Play services was observed posting a tag
 * ending in a Google account ID, and WhatsApp and Messenger embed stable
 * per-conversation identifiers. Forwarding the key would hand the relay a
 * persistent account identifier and a conversation graph as plaintext metadata,
 * which no amount of payload encryption offsets.
 *
 * `packageName` — the receiver displays `sourceApp`, and FR-10's filtering runs
 * on the *sender*, so the package name has no job on the far side. If M1 shows
 * the receiver needs it after all, that is exactly the kind of finding this
 * milestone exists to produce — add it deliberately, not by accident.
 */
export type ForwardedNotification = {
  /** Unique per delivery. Distinct from FR-8's dedupe key, which is on-device. */
  id: string;
  /** Consecutive per sender device (FR-26). A gap means a notification was lost. */
  seq: number;
  /** Human-readable app name — falls back to the package when unresolvable. */
  sourceApp: string;
  title: string | null;
  body: string | null;
  /** Epoch ms, carried from StatusBarNotification.postTime, not send time. */
  timestamp: number;
  deviceLabel: string;
};

/**
 * Builds the wire payload by naming every field explicitly.
 *
 * This is written as explicit construction rather than `Omit<..., "key">` or a
 * spread-and-delete on purpose. With a spread, a field added to
 * `CapturedNotification` later flows onto the wire silently and nobody reviews
 * it; here, anything new has to be added by hand, which is the review. The
 * privacy boundary in §7 is worth one deliberately tedious function.
 */
export function toForwarded(
  captured: CapturedNotification,
  seq: number,
  deviceLabel: string,
): ForwardedNotification {
  return {
    id: `${captured.postTime}-${seq}`,
    seq,
    sourceApp: captured.appLabel ?? captured.packageName,
    title: captured.title,
    body: captured.body,
    timestamp: captured.postTime,
    deviceLabel,
  };
}

export type SendResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * POSTs one notification to the M1 receiver.
 *
 * Plain HTTP, no retry, no queue, no encryption — all four arrive later and
 * none of them belong in a milestone that gets deleted at M3. Cleartext works
 * because the React Native debug manifest sets `usesCleartextTraffic="true"`;
 * a release build would not, which is fine, because this code never ships.
 *
 * The timeout matters more than it looks: without it a wrong IP leaves the
 * request hanging on Android's default connect timeout, and the UI reports
 * nothing at all for well over a minute — which reads as "capture is broken"
 * rather than "that address is wrong".
 */
export async function sendToReceiver(
  host: string,
  payload: ForwardedNotification,
  timeoutMs = 4000,
): Promise<SendResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`http://${host}/notify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!response.ok) {
      return { ok: false, error: `HTTP ${response.status}` };
    }
    return { ok: true };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    // An aborted fetch reports as a generic failure; say which it was, because
    // "timed out" and "connection refused" point at different mistakes.
    return {
      ok: false,
      error: controller.signal.aborted ? `timed out after ${timeoutMs}ms` : message,
    };
  } finally {
    clearTimeout(timer);
  }
}
