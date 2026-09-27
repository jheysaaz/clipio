/**
 * Snippet normalisation shared by every storage backend.
 *
 * This function existed as three byte-identical private copies — one in each of
 * `sync.ts`, `local.ts` and `indexeddb.ts` — each a one-line wrapper whose only
 * content was the `as Snippet` cast. That is three places to remember when
 * anything about normalisation changes, and a silent way for the backends to
 * drift apart, which is the exact failure that made the legacy
 * `contentFormat` migration inconsistent before it was consolidated.
 *
 * spec: specs/content-format-migration.spec.md
 */

import type { Snippet } from "@/types";
import { migrateContentFormat } from "@/lib/content-format-migration";

/**
 * Bring a stored snippet to its canonical shape.
 *
 * Today that means converting a legacy HTML body to markdown and dropping the
 * retired `contentFormat` key — a no-op for every snippet written since the
 * field was retired, but it must run on **every** read, because the legacy
 * format has no version marker of its own.
 */
export function normalizeStoredSnippet(snippet: Snippet): Snippet {
  return migrateContentFormat(snippet) as Snippet;
}
