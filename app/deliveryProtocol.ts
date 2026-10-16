/** Wire validation shared by the Android receiver and the Node verification. */
export type ForwardedNotification = {
  id: string;
  seq: number;
  sourceApp: string;
  title: string | null;
  body: string | null;
  timestamp: number;
  deviceLabel: string;
};

export type RelayMessage = { v: "1"; id: string; p?: string };
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export function parseRelayMessage(value: unknown): RelayMessage | null {
  if (!record(value)) return null;
  // Expo's native RemoteMessageSerializer preserves FCM data keys directly.
  // dataString/body is also accepted for the documented Expo data shape.
  if (record(value.data)) value = value.data;
  if (!record(value)) return null;
  if (typeof value.dataString === "string" || typeof value.body === "string") {
    try { value = JSON.parse((value.dataString ?? value.body) as string); }
    catch { return null; }
  }
  if (!record(value) || value.v !== "1" || typeof value.id !== "string" ||
      !/^[A-Za-z0-9_-]{22}$/.test(value.id)) return null;
  if (value.p !== undefined && !validCiphertext(value.p)) return null;
  return { v: "1", id: value.id, ...(typeof value.p === "string" ? { p: value.p } : {}) };
}

export function validCiphertext(value: unknown): value is string {
  return typeof value === "string" && value.length >= 40 && value.length <= 65536 &&
    value.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(value);
}

/** SDK 57's Android fromCombined bridge accepts a Uint8Array, not base64 text. */
export function decodeCiphertext(value: string): Uint8Array {
  if (!validCiphertext(value)) throw new Error("invalid encrypted envelope");
  try { return Uint8Array.from(atob(value), byte => byte.charCodeAt(0)); }
  catch { throw new Error("invalid encrypted envelope"); }
}

export function validateNotification(value: unknown): ForwardedNotification {
  if (!record(value) || "key" in value || "packageName" in value ||
      typeof value.id !== "string" || value.id.length === 0 || value.id.length > 200 ||
      !Number.isSafeInteger(value.seq) || (value.seq as number) < 1 ||
      typeof value.sourceApp !== "string" || value.sourceApp.length > 500 ||
      typeof value.deviceLabel !== "string" || value.deviceLabel.length > 500 ||
      !Number.isSafeInteger(value.timestamp) || (value.timestamp as number) < 0 ||
      !(value.title === null || typeof value.title === "string") ||
      !(value.body === null || typeof value.body === "string")) {
    // Never include the rejected payload in an exception or diagnostic.
    throw new Error("invalid decrypted notification");
  }
  return value as ForwardedNotification;
}

export type DeliveryOutcome = "displayed" | "duplicate" | "blocked" | "rejected" | "failed";
export type Receipt = { notificationId: string; seq: number };
export interface ReceiverDependencies {
  peer(): Promise<string | null>;
  fetch(id: string): Promise<{ sender: string; ciphertext: string } | null>;
  decrypt(ciphertext: string): Promise<ForwardedNotification>;
  canDisplay(): Promise<boolean>;
  findReceipt(sender: string, notificationId: string, seq: number): Promise<Receipt | null>;
  display(notification: ForwardedNotification, sender: string): Promise<void>;
  saveReceipt(sender: string, notification: ForwardedNotification): Promise<void>;
  queueAck(id: string): Promise<void>;
  acknowledge(id: string): Promise<boolean>;
  finishAck(id: string): Promise<void>;
}

/** Serialize concurrent FCM callbacks and catch-up so the same message posts once. */
export function createReceiver(deps: ReceiverDependencies) {
  let tail = Promise.resolve<unknown>(undefined);
  return (message: RelayMessage): Promise<DeliveryOutcome> => {
    const work = tail.then(async (): Promise<DeliveryOutcome> => {
      try {
        const sender = await deps.peer();
        if (!sender) return "blocked";
        let ciphertext = message.p;
        if (!ciphertext) {
          const blob = await deps.fetch(message.id);
          if (!blob) return "failed";
          if (blob.sender !== sender) return "rejected";
          ciphertext = blob.ciphertext;
        }
        if (!validCiphertext(ciphertext)) return "rejected";
        let notification: ForwardedNotification;
        try { notification = validateNotification(await deps.decrypt(ciphertext)); }
        catch { return "rejected"; }
        const receipt = await deps.findReceipt(sender, notification.id, notification.seq);
        if (receipt && (receipt.notificationId !== notification.id || receipt.seq !== notification.seq)) {
          return "rejected";
        }
        if (!receipt) {
          if (!(await deps.canDisplay())) return "blocked";
          await deps.display(notification, sender);
          // A crash before this write may re-post the same native notification tag;
          // it cannot create a second shade entry. Never ack before notify succeeds.
          await deps.saveReceipt(sender, notification);
        }
        await deps.queueAck(message.id);
        if (await deps.acknowledge(message.id)) await deps.finishAck(message.id);
        return receipt ? "duplicate" : "displayed";
      } catch { return "failed"; }
    });
    tail = work.catch(() => undefined);
    return work;
  };
}

export function retryDelay(attempt: number): number {
  return Math.min(60_000, 1000 * 2 ** Math.min(attempt, 6));
}
