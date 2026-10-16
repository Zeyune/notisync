import * as Notifications from "expo-notifications";
import { AppState, Platform } from "react-native";

import { registerWithRelay } from "./relayClient";
import { initPairing } from "./pairingState";
import { ensureReceiverChannel, ensureReceiverTask, recoverDeliveries } from "./receiver";
import { flushOutbox } from "./forwarding";

/**
 * Push registration (FR-16, FR-31).
 *
 * PRD §8 names `@react-native-firebase/messaging`; this uses `expo-notifications`
 * instead — one first-party native dependency rather than two, and every Expo
 * module so far has integrated cleanly on the first build. The deviation is
 * recorded in notification-sync-m3-plan.md along with the fallback, because
 * RNFirebase's `setBackgroundMessageHandler` is better proven for waking a
 * killed app. If M3.3 shows unreliable delivery, only this file changes.
 *
 * **The token here is the raw FCM registration token**, from
 * `getDevicePushTokenAsync()` — not an Expo push token. That distinction is the
 * whole point: an Expo push token would route delivery through Expo's servers,
 * putting a third party in the path of a product whose pitch is that there is
 * not one (FR-30). Our relay calls FCM directly.
 */

export type PushState = {
  permissionGranted: boolean;
  token: string | null;
  error: string | null;
  receiverReady?: boolean;
};

/**
 * Rejects if a promise has not settled in time.
 *
 * Needed because a hung promise and a slow one are indistinguishable to a
 * caller, and only one of them is worth waiting for.
 */
async function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<T>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}

/**
 * FR-31 — request `POST_NOTIFICATIONS` on Android 13+.
 *
 * Without it the receiver installs, pairs and registers perfectly, and then
 * displays nothing. The PRD calls this out specifically as "a silent failure
 * mode that must be caught at setup, not discovered at 2am" — which is why the
 * result is surfaced in the UI rather than requested and forgotten.
 */
export async function ensureNotificationPermission(): Promise<boolean> {
  await ensureReceiverChannel();
  const existing = await Notifications.getPermissionsAsync();
  if (existing.granted) return true;
  if (!existing.canAskAgain) return false;

  const requested = await Notifications.requestPermissionsAsync();
  return requested.granted;
}

/**
 * Obtains the device's FCM token and reports it to the relay.
 *
 * Run on every launch, not once at setup: FCM tokens rotate on reinstall, on a
 * data clear, and at Google's discretion. A stale token fails silently — the
 * relay accepts the send, FCM discards it, and nothing on either device says so.
 * Re-registering is one cheap request and removes that failure mode.
 */
export async function registerForPush(requestPermission = true): Promise<PushState> {
  if (Platform.OS !== "android") {
    // iOS is deferred: FR-35's Notification Service Extension needs a Mac and an
    // Apple Developer membership. See notification-sync-m3-plan.md.
    return { permissionGranted: false, token: null, error: "iOS receiver not implemented" };
  }

  let permissionGranted = false;
  try {
    await initPairing();
    await ensureReceiverChannel();
    await ensureReceiverTask();
    permissionGranted = requestPermission
      ? await ensureNotificationPermission()
      : (await Notifications.getPermissionsAsync()).granted;
  } catch { return { permissionGranted, token: null, receiverReady: false, error: "identity or background receiver setup failed" }; }

  let token: string | null = null;
  try {
    // Bounded, because `getDevicePushTokenAsync()` can hang indefinitely rather
    // than reject: when Google Play services cannot complete FCM registration it
    // retries on its own backoff schedule (observed at 26s, 38s, 64s) and the
    // promise simply never settles. Without this the UI sits on "registering..."
    // forever with nothing to diagnose, which is the same silent-failure shape
    // FR-33 exists to eliminate.
    //
    // 60s, not 20s: a device's *first* FCM registration was measured taking over
    // a minute on this Samsung, while every later call returned instantly from
    // cache. A shorter bound fails the one case that is slow for a legitimate
    // reason — a fresh install — and reports it as an error.
    const devicePushToken = await withTimeout(
      Notifications.getDevicePushTokenAsync(),
      60_000,
      "FCM registration did not complete in 60s",
    );
    token = typeof devicePushToken.data === "string" ? devicePushToken.data : null;
  } catch (e) {
    return {
      permissionGranted,
      token: null,
      receiverReady: true,
      error: "could not get FCM token within 60s; check Google Play services and network",
    };
  }

  if (!token) return { permissionGranted, token: null, receiverReady: true, error: "no Android FCM token" };
  let registered;
  try { registered = await registerWithRelay(token); }
  catch { return { permissionGranted, token, receiverReady: true, error: "could not persist relay registration" }; }
  if (!registered.ok) {
    // The token exists but the relay does not know it, so this device is
    // unreachable. Reported rather than swallowed — an unreachable receiver is
    // indistinguishable from a working one until a notification goes missing.
    return { permissionGranted, token, receiverReady: true, error: `relay registration failed — ${registered.error}` };
  }

  return { permissionGranted, token, receiverReady: true, error: null };
}

/** Every foreground launch/resume re-reads FCM's current token. A native refresh
 * event is also synced while JS is alive; a refresh while JS is absent is caught
 * on next resume. No assumption that the old token survives reinstall is made. */
export function startPushLifecycle(onState: (state: PushState) => void): () => void {
  let disposed = false;
  let refreshing: Promise<void> | null = null;
  const sync = (requestPermission = false) => {
    if (refreshing) return;
    refreshing = (async () => {
      const state = await registerForPush(requestPermission);
      if (!disposed) onState(state);
      if (!state.error) await recoverDeliveries();
      await flushOutbox();
    })().catch(() => {
      if (!disposed) onState({ permissionGranted: false, token: null, error: "push lifecycle or delivery recovery failed" });
    }).finally(() => { refreshing = null; });
  };
  sync(true);
  const resume = AppState.addEventListener("change", state => { if (state === "active") sync(); });
  const tokens = Notifications.addPushTokenListener(token => {
    if (typeof token.data !== "string") return;
    void registerWithRelay(token.data).then(result => {
      if (!result.ok && !disposed) onState({ permissionGranted: false, token: null, error: "FCM token refresh registration failed" });
    }).catch(() => {
      if (!disposed) onState({ permissionGranted: false, token: null, error: "FCM token refresh storage failed" });
    });
  });
  const retry = setInterval(() => {
    if (AppState.currentState === "active") {
      void flushOutbox().catch(() => undefined);
      void recoverDeliveries().catch(() => undefined);
    }
  }, 15_000);
  return () => { disposed = true; resume.remove(); tokens.remove(); clearInterval(retry); };
}
