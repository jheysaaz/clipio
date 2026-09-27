/**
 * Snippet schema validation for untrusted import payloads.
 *
 * An import file is something the user was talked into importing. It may be
 * malformed, hostile, or simply enormous. Every field that reaches storage is
 * bounded and type-checked here, once, so no importer and no storage path has
 * to repeat the checks — and so a second, weaker copy of them cannot drift in.
 *
 * spec: specs/import-validation.spec.md
 */

import type { Snippet, ContentFormat } from "@/types";

/**
 * Hard bounds applied to an imported snippet set.
 *
 * The snippet-count and content-length limits exist for a concrete reason:
 * `browser.storage.sync` allows 512 items and 102,400 bytes total. An import
 * that exceeds either bricks sync mode permanently — every subsequent write
 * throws a quota error, the manager flips the user to local storage, and their
 * snippets stop syncing across devices with no way back except a manual switch.
 * A single unbounded `content` string is enough to do it.
 */
export const IMPORT_LIMITS = {
  /** Maximum size of the whole import file. */
  maxFileBytes: 8 * 1024 * 1024,
  /** Maximum snippets accepted in one import. */
  maxSnippets: 2000,
  /** Maximum characters of snippet body. */
  maxContentLength: 32_000,
  /** Maximum characters of label. */
  maxLabelLength: 200,
  /** Maximum characters of shortcut. */
  maxShortcutLength: 64,
  /** Maximum tags, and maximum characters per tag. */
  maxTags: 20,
  maxTagLength: 40,
} as const;

/** Keys that must never appear, to stop prototype pollution via a crafted id. */
const FORBIDDEN_ID_SUBSTRINGS = ["__proto__", "constructor", "prototype"];

export type SnippetRejection =
  | "not-an-object"
  | "missing-id"
  | "id-too-long"
  | "id-unsafe"
  | "missing-label"
  | "label-too-long"
  | "missing-shortcut"
  | "shortcut-too-long"
  | "missing-content"
  | "content-too-long"
  | "bad-content-format"
  | "bad-tags"
  | "bad-timestamp"
  | "bad-usage-count";

export type ValidationResult =
  { ok: true; snippet: Snippet } | { ok: false; reason: SnippetRejection };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

/**
 * Validate and normalise one imported record.
 *
 * Normalisation is deliberate rather than rejection: a missing
 * `contentFormat` is filled in, timestamps default to now, and a nonsensical
 * `usageCount` is clamped. Those are recoverable and refusing them would lose
 * a user's real snippet over a cosmetic defect. Everything that is a genuine
 * integrity or safety problem is rejected.
 */
export function validateImportedSnippet(raw: unknown): ValidationResult {
  if (!isPlainObject(raw)) return { ok: false, reason: "not-an-object" };

  const id = raw["id"];
  if (typeof id !== "string" || id.length === 0) {
    return { ok: false, reason: "missing-id" };
  }
  if (id.length > IMPORT_LIMITS.maxLabelLength * 2) {
    return { ok: false, reason: "id-too-long" };
  }
  if (FORBIDDEN_ID_SUBSTRINGS.some((bad) => id.includes(bad))) {
    return { ok: false, reason: "id-unsafe" };
  }

  const label = raw["label"];
  if (typeof label !== "string") return { ok: false, reason: "missing-label" };
  if (label.length > IMPORT_LIMITS.maxLabelLength) {
    return { ok: false, reason: "label-too-long" };
  }

  const shortcut = raw["shortcut"];
  if (typeof shortcut !== "string") {
    return { ok: false, reason: "missing-shortcut" };
  }
  if (shortcut.length > IMPORT_LIMITS.maxShortcutLength) {
    return { ok: false, reason: "shortcut-too-long" };
  }

  const content = raw["content"];
  if (typeof content !== "string") {
    return { ok: false, reason: "missing-content" };
  }
  if (content.length > IMPORT_LIMITS.maxContentLength) {
    return { ok: false, reason: "content-too-long" };
  }

  // contentFormat is the vestigial pre-1.x HTML flag. It is accepted on the
  // wire for backwards compatibility but normalised to "markdown" here: the
  // editor always serialises markdown, so an "html" label on a markdown body
  // is the data-corruption vector, not a supported format.
  const rawFormat = raw["contentFormat"];
  if (
    rawFormat !== undefined &&
    rawFormat !== null &&
    rawFormat !== "markdown" &&
    rawFormat !== "html"
  ) {
    return { ok: false, reason: "bad-content-format" };
  }
  const contentFormat: ContentFormat = "markdown";

  const rawTags = raw["tags"];
  let tags: string[] = [];
  if (rawTags !== undefined && rawTags !== null) {
    if (!Array.isArray(rawTags)) return { ok: false, reason: "bad-tags" };
    if (rawTags.length > IMPORT_LIMITS.maxTags) {
      return { ok: false, reason: "bad-tags" };
    }
    const cleaned: string[] = [];
    for (const tag of rawTags) {
      if (typeof tag !== "string") return { ok: false, reason: "bad-tags" };
      if (tag.length > IMPORT_LIMITS.maxTagLength) {
        return { ok: false, reason: "bad-tags" };
      }
      cleaned.push(tag);
    }
    tags = cleaned;
  }

  const now = new Date().toISOString();
  const createdAt = raw["createdAt"];
  const updatedAt = raw["updatedAt"];
  if (
    (createdAt !== undefined && !isIsoTimestamp(createdAt)) ||
    (updatedAt !== undefined && !isIsoTimestamp(updatedAt))
  ) {
    return { ok: false, reason: "bad-timestamp" };
  }

  const rawUsage = raw["usageCount"];
  if (
    rawUsage !== undefined &&
    rawUsage !== null &&
    (typeof rawUsage !== "number" ||
      !Number.isFinite(rawUsage) ||
      rawUsage < 0 ||
      !Number.isSafeInteger(rawUsage))
  ) {
    return { ok: false, reason: "bad-usage-count" };
  }
  const usageCount =
    typeof rawUsage === "number" && Number.isSafeInteger(rawUsage)
      ? Math.max(0, rawUsage)
      : 0;

  return {
    ok: true,
    snippet: {
      id,
      label,
      shortcut,
      content,
      contentFormat,
      tags,
      usageCount,
      createdAt: (createdAt as string | undefined) ?? now,
      updatedAt: (updatedAt as string | undefined) ?? now,
    },
  };
}

export type ImportValidation = {
  /** Records that passed validation, normalised. */
  accepted: Snippet[];
  /** Why each rejected record was rejected, in input order. */
  rejected: { index: number; reason: SnippetRejection }[];
  /** True when the snippet count itself exceeded the limit. */
  tooManySnippets: boolean;
};

/**
 * Validate a whole import payload.
 *
 * A record that fails validation is skipped rather than aborting the import:
 * one malformed entry in an otherwise good export should not cost the user
 * their other 200 snippets. The count of rejects is returned so the UI can say
 * so out loud instead of silently dropping data.
 */
export function validateImportPayload(raw: unknown): ImportValidation {
  if (!Array.isArray(raw)) {
    return { accepted: [], rejected: [], tooManySnippets: false };
  }

  const tooManySnippets = raw.length > IMPORT_LIMITS.maxSnippets;
  const accepted: Snippet[] = [];
  const rejected: { index: number; reason: SnippetRejection }[] = [];
  const seenIds = new Set<string>();

  for (const [index, entry] of raw.entries()) {
    if (accepted.length >= IMPORT_LIMITS.maxSnippets) break;
    const result = validateImportedSnippet(entry);
    if (!result.ok) {
      rejected.push({ index, reason: result.reason });
      continue;
    }
    // A duplicate id in the file would silently overwrite the earlier record.
    if (seenIds.has(result.snippet.id)) {
      rejected.push({ index, reason: "id-unsafe" });
      continue;
    }
    seenIds.add(result.snippet.id);
    accepted.push(result.snippet);
  }

  return { accepted, rejected, tooManySnippets };
}

/**
 * Narrowing predicate form, for call sites that only need a boolean.
 *
 * Prefer `validateImportedSnippet` where the normalised record is wanted —
 * this discards the normalisation.
 */
export function isValidImportedSnippet(raw: unknown): raw is Snippet {
  return validateImportedSnippet(raw).ok;
}
