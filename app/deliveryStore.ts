import { openDatabaseAsync } from "expo-sqlite";
import type { SQLiteDatabase } from "expo-sqlite";
import type { ForwardedNotification, Receipt } from "./deliveryProtocol";
import { DELIVERY_SCHEMA, NEXT_SEQUENCE_SQL, FIND_RECEIPT_SQL, GAP_COUNT_SQL } from "./deliverySql";

// Only ciphertext and delivery bookkeeping are persisted. No plaintext or keys.
let opening: Promise<SQLiteDatabase> | null = null;
export function deliveryDB(): Promise<SQLiteDatabase> {
  if (!opening) opening = openDatabaseAsync("notifsync-delivery.db").then(async db => {
    await db.execAsync(DELIVERY_SCHEMA);
    return db;
  }).catch(e => { opening = null; throw e; });
  return opening;
}

export async function nextSequence(pair: string): Promise<number> {
  const db = await deliveryDB();
  const row = await db.getFirstAsync<{ seq: number }>(
    NEXT_SEQUENCE_SQL, pair);
  if (!row) throw new Error("sequence storage failed");
  return row.seq;
}
export async function findReceipt(sender: string, id: string, seq: number): Promise<Receipt | null> {
  const db = await deliveryDB();
  return db.getFirstAsync<Receipt>(
    FIND_RECEIPT_SQL, sender, id, seq);
}
export async function saveReceipt(sender: string, n: ForwardedNotification): Promise<void> {
  const db = await deliveryDB();
  await db.runAsync("INSERT INTO receipts(sender, notification_id, seq, received_at) VALUES (?, ?, ?, ?)", sender, n.id, n.seq, Date.now());
}
export async function setDiagnostic(name: string, value: string): Promise<void> {
  const db = await deliveryDB();
  await db.runAsync("INSERT INTO diagnostics(name, value) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET value = excluded.value", name, value);
}
export async function deliverySummary(): Promise<string> {
  const db = await deliveryDB();
  const count = await db.getFirstAsync<{ n: number }>("SELECT COUNT(*) AS n FROM outbox");
  const acks = await db.getFirstAsync<{ n: number }>("SELECT COUNT(*) AS n FROM pending_acks");
  const gaps = await db.getFirstAsync<{ n: number }>(
    GAP_COUNT_SQL);
  const statuses = await db.getAllAsync<{ name: string; value: string }>("SELECT name, value FROM diagnostics ORDER BY name");
  return `Queued: ${count?.n ?? 0} · pending ack: ${acks?.n ?? 0} · sequence gaps: ${gaps?.n ?? 0}\n${statuses.map(s => `${s.name}: ${s.value}`).join("\n")}`;
}
