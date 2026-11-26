/**
 * Stable local writer identity for last-writer-wins resolution.
 *
 * There is no account or sign-in in Clipio, so the only identity available is
 * one this install makes for itself. It is deliberately not part of any backup
 * or export: restoring a backup should not make two installs indistinguishable.
 */

import { writerIdItem } from "./items";

export async function getWriterId(): Promise<string> {
  const existing = await writerIdItem.getValue();
  if (existing && existing !== "unknown") return existing;

  const created = crypto.randomUUID();
  await writerIdItem.setValue(created);
  return created;
}
