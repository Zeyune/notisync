import * as Notifications from "expo-notifications";
import * as TaskManager from "expo-task-manager";
import { Platform } from "react-native";
import { open } from "./crypto";
import { initPairing, peerAddress } from "./pairingState";
import { ackBlob, fetchBlob, pendingBlobs, relayUrl } from "./relayClient";
import { deliveryDB, findReceipt, saveReceipt, setDiagnostic } from "./deliveryStore";
import { createReceiver, parseRelayMessage } from "./deliveryProtocol";
import NotificationListener from "./modules/notification-listener";

export const RECEIVER_TASK = "notifsync-receive-v1";
export const RECEIVED_CHANNEL = "notifsync-received";

export async function ensureReceiverChannel(): Promise<void> {
  if (Platform.OS === "android") await Notifications.setNotificationChannelAsync(RECEIVED_CHANNEL, {
    name: "Synced notifications", importance: Notifications.AndroidImportance.HIGH,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
  });
}

export async function canDisplay(): Promise<boolean> {
  const permission = await Notifications.getPermissionsAsync();
  const channel = await Notifications.getNotificationChannelAsync(RECEIVED_CHANNEL);
  return permission.granted && !!channel && channel.importance !== Notifications.AndroidImportance.NONE;
}

const receive = createReceiver({
  peer: async () => { await initPairing(); return peerAddress(); },
  fetch: async id => { const result = await fetchBlob(id); return result.ok ? result.value : null; },
  decrypt: open,
  canDisplay,
  findReceipt,
  display: async (notification, sender) => {
    const text = [notification.title, notification.body].filter(Boolean).join("\n");
    const posted = NotificationListener.displayNotification(
      `${sender}:${notification.id}`, `${notification.deviceLabel} · ${notification.sourceApp}`, text, sender);
    if (!posted) throw new Error("Android notification display blocked");
  },
  saveReceipt,
  queueAck: async id => {
    const db = await deliveryDB();
    await db.runAsync("INSERT OR IGNORE INTO pending_acks(id, relay) VALUES (?, ?)", id, await relayUrl());
  },
  acknowledge: async id => (await ackBlob(id)).ok,
  finishAck: async id => { const db = await deliveryDB(); await db.runAsync("DELETE FROM pending_acks WHERE id = ?", id); },
});

export async function handlePush(data: unknown, origin: "push" | "catch-up" = "push"): Promise<void> {
  const message = parseRelayMessage(data);
  if (!message) return; // Includes local notification responses and unrelated pushes.
  try {
    await ensureReceiverChannel();
    const outcome = await receive(message);
    await setDiagnostic("receiver", `${origin} ${outcome} at ${new Date().toISOString()}`);
    // Only fixed outcome and time are logged. No content, public pairing code,
    // key fingerprint, ciphertext, or token is passed to console.
    console.info(`NotifSync receiver: ${origin} ${outcome}`);
  } catch { console.warn("NotifSync receiver: storage or setup failed"); }
}

// Task definition is imported by index.ts before React mounts, including headless starts.
if (Platform.OS === "android" && !TaskManager.isTaskDefined(RECEIVER_TASK)) {
  TaskManager.defineTask<Notifications.NotificationTaskPayload>(RECEIVER_TASK, async ({ data, error }) => {
    if (error) {
      console.warn("NotifSync receiver: background task failed");
      return;
    }
    await handlePush(data);
  });
}

let registering: Promise<void> | null = null;
export function ensureReceiverTask(): Promise<void> {
  if (Platform.OS !== "android") return Promise.resolve();
  if (!registering) registering = (async () => {
    if (!(await TaskManager.isTaskRegisteredAsync(RECEIVER_TASK))) await Notifications.registerTaskAsync(RECEIVER_TASK);
  })().catch(error => { registering = null; throw error; });
  return registering;
}

let recovering: Promise<void> | null = null;
/** Reopen/resume catches missed pushes and retries acks, without re-displaying receipts. */
export function recoverDeliveries(): Promise<void> {
  if (recovering) return recovering;
  recovering = recover().finally(() => { recovering = null; });
  return recovering;
}
async function recover(): Promise<void> {
  await initPairing();
  const db = await deliveryDB();
  const acks = await db.getAllAsync<{ id: string; relay: string }>("SELECT id, relay FROM pending_acks LIMIT 50");
  for (const ack of acks) {
    if ((await ackBlob(ack.id, ack.relay)).ok) await db.runAsync("DELETE FROM pending_acks WHERE id = ?", ack.id);
    else break;
  }
  if (!peerAddress()) return;
  const pending = await pendingBlobs();
  if (!pending.ok) {
    await setDiagnostic("catch-up", pending.status === 404 ? "pending endpoint unavailable; deploy updated relay" : pending.error);
    return;
  }
  // Bounded work on resume. Subsequent resumes recover the next page after acks.
  for (const blob of pending.value.blobs) {
    if (blob.sender !== peerAddress()) continue;
    await handlePush({ v: "1", id: blob.id, p: blob.ciphertext }, "catch-up");
  }
}
