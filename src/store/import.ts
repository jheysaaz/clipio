/**
 * The import wizard's state, and the decisions that move it between steps.
 *
 * ── Why the decisions are exported ──────────────────────────────────────────
 *
 * `ImportWizard.tsx` held twenty-two `useState` slices and, more to the point,
 * held the *step machine* inside the component: whether step 2 was needed at all,
 * what to do with a snippet whose placeholders are unsupported, whether step 3 was
 * needed, and how many snippets an import would actually add.
 *
 * Those four were functions closing over component state, so none could be tested
 * without rendering the whole wizard and driving it through a file input. The
 * merge helpers next door (`merge.ts`) are tested; the routing between them was
 * not, and the routing is where a wizard goes wrong — skipping the conflict step
 * silently overwrites, and skipping the placeholder step silently mangles a
 * snippet.
 *
 * So the decisions are pure and exported, and the component renders.
 */

import { createStore } from "@tanstack/store";
import { useStore } from "@tanstack/react-store";

import type { Snippet } from "@/types";
import type {
  ConflictEntry,
  FormatId,
  ParsedSnippet,
  UnsupportedPlaceholderEntry,
} from "@/lib/importers/types";
import {
  applyUnsupportedAction,
  buildFinalSnippets,
  detectConflicts,
  estimateJsonSize,
  suggestShortcut,
} from "@/lib/importers/merge";
import { getParser } from "@/lib/importers/registry";
import { remapMediaIds } from "@/lib/media-placeholders";
import { getSnippets, getStorageStatus, bulkSaveSnippets } from "@/storage";
import { SYNC_QUOTA } from "@/config/constants";
import { captureError, captureMessage } from "@/lib/sentry";
import { i18n } from "#i18n";

/** 1 upload · 2 placeholders · 3 conflicts · 4 confirm. */
export type WizardStep = 1 | 2 | 3 | 4;

export type ImportState = {
  step: WizardStep;
  /** The library as it stands, for conflict detection. */
  existingSnippets: Snippet[];
  isDragging: boolean;
  fileName: string | null;
  rawJson: Record<string, unknown> | unknown[] | null;
  detectedFormat: FormatId | null;
  selectedFormat: FormatId | "";
  parseError: string | null;
  parsedSnippets: ParsedSnippet[];
  /** Step 2. */
  unsupportedEntries: UnsupportedPlaceholderEntry[];
  /** Step 3. */
  conflictEntries: ConflictEntry[];
  /** Step 4. */
  importing: boolean;
  importDone: boolean;
  importedCount: number;
  importError: string | null;
  storageMode: "sync" | "local";
  /** ZIP exports. */
  isZipImport: boolean;
  zipMediaCount: number;
  zipMissingMediaWarning: string | null;
  /**
   * Resolved media from a ZIP, held until the user confirms.
   *
   * Not reactive state — it is blobs, and putting them in the store would make
   * every subscriber's selector run against megabytes. Held here rather than in a
   * `useRef` so the import has one owner of everything it needs.
   */
  zipMediaBlobs: Map<string, ZipMediaEntry>;
};

export type ZipMediaEntry = {
  blob: Blob;
  meta: import("~/storage/backends/media").MediaMetadata;
};

export const importStore = createStore<ImportState>({
  step: 1,
  existingSnippets: [],
  isDragging: false,
  fileName: null,
  rawJson: null,
  detectedFormat: null,
  selectedFormat: "",
  parseError: null,
  parsedSnippets: [],
  unsupportedEntries: [],
  conflictEntries: [],
  importing: false,
  importDone: false,
  importedCount: 0,
  importError: null,
  storageMode: "sync",
  isZipImport: false,
  zipMediaCount: 0,
  zipMissingMediaWarning: null,
  zipMediaBlobs: new Map(),
});

// ---------------------------------------------------------------------------
// Pure decisions
// ---------------------------------------------------------------------------

/** Whether any parsed snippet carries a placeholder the importer could not keep. */
export function needsPlaceholderStep(
  snippets: readonly ParsedSnippet[]
): boolean {
  return snippets.some((s) => s.unsupportedPlaceholders.length > 0);
}

/**
 * Seed the step-2 rows.
 *
 * Every row defaults to `"keep"`. That is the non-destructive choice, and it is
 * the right default for the failure this step exists to handle: a placeholder the
 * importer did not understand is still better left as the original text than
 * silently deleted from someone's snippet.
 */
export function seedUnsupportedEntries(
  snippets: readonly ParsedSnippet[]
): UnsupportedPlaceholderEntry[] {
  return snippets
    .filter((s) => s.unsupportedPlaceholders.length > 0)
    .map((s) => ({ snippet: s, action: "keep" }));
}

/**
 * Apply the user's per-snippet placeholder choices.
 *
 * Rows the user never saw — a snippet with no unsupported placeholders — are
 * passed through unchanged rather than dropped, because `applyUnsupportedAction`
 * returning `null` means "this action removes the snippet", not "this snippet had
 * nothing to do". Defaulting an unseen row to `"keep"` and then dropping it would
 * silently lose snippets the wizard never asked about.
 *
 * Keyed by `suggestedId` because that is what identifies a parsed snippet across
 * the step boundary, not its position in the array.
 */
export function applyUnsupportedChoices(
  snippets: readonly ParsedSnippet[],
  entries: readonly UnsupportedPlaceholderEntry[]
): ParsedSnippet[] {
  const byId = new Map(entries.map((e) => [e.snippet.suggestedId, e.action]));
  const out: ParsedSnippet[] = [];
  for (const snippet of snippets) {
    const action = byId.get(snippet.suggestedId) ?? "keep";
    const result = applyUnsupportedAction(snippet, action);
    if (result !== null) out.push(result);
  }
  return out;
}

/**
 * Prefill a suggested shortcut for every conflict.
 *
 * Every conflict gets a suggestion, not only the ones resolved as `"rename"`: the
 * user can change a resolution after this runs, and a row whose shortcut field
 * starts empty has nothing to show them. The previous code computed it in a
 * ternary whose two branches were identical — which read as "only rename gets
 * one" and was not what it did.
 */
export function prefillConflictResolutions(
  incoming: readonly ParsedSnippet[],
  existing: readonly Snippet[]
): ConflictEntry[] {
  return detectConflicts([...incoming], [...existing]).map((c) => ({
    ...c,
    renamedShortcut: suggestShortcut(c.incoming.shortcut, [...existing]),
  }));
}

/**
 * What a step transition resolves to, and the snippet list it resolved *from*.
 *
 * The resolved list is part of the result on purpose. An earlier version computed
 * it inside this function, used it to detect conflicts, and let the caller store
 * whatever list it happened to be holding — so the user's placeholder choices were
 * applied to the conflicts and then thrown away, and the confirmation step wrote
 * the unresolved text. Two steps agreeing on which snippets they are talking
 * about has to be structural, not a convention.
 */
export type StepRouting =
  | {
      kind: "review-placeholders";
      entries: UnsupportedPlaceholderEntry[];
      snippets: readonly ParsedSnippet[];
    }
  | {
      kind: "review-conflicts";
      entries: ConflictEntry[];
      snippets: readonly ParsedSnippet[];
    }
  | { kind: "confirm"; snippets: readonly ParsedSnippet[] };

/**
 * Where the wizard goes after step 1.
 *
 * Both intermediate steps are conditional, and each is skipped only when it has
 * nothing to do. Step 2 exists for placeholders that could not be kept; step 3 for
 * snippets that already exist. Skipping step 3 unconditionally would overwrite;
 * skipping step 2 unconditionally would mangle a snippet's text without ever
 * telling the user.
 */
export function routeAfterUpload(
  parsed: readonly ParsedSnippet[],
  existing: readonly Snippet[]
): StepRouting {
  if (needsPlaceholderStep(parsed)) {
    return {
      kind: "review-placeholders",
      entries: seedUnsupportedEntries(parsed),
      snippets: parsed,
    };
  }
  const conflicts = prefillConflictResolutions(parsed, existing);
  if (conflicts.length > 0) {
    return { kind: "review-conflicts", entries: conflicts, snippets: parsed };
  }
  return { kind: "confirm", snippets: parsed };
}

/** Where the wizard goes after the placeholder step. */
export function routeAfterPlaceholders(
  parsed: readonly ParsedSnippet[],
  entries: readonly UnsupportedPlaceholderEntry[],
  existing: readonly Snippet[]
): StepRouting {
  const resolved = applyUnsupportedChoices(parsed, entries);
  const conflicts = prefillConflictResolutions(resolved, existing);
  if (conflicts.length > 0) {
    return { kind: "review-conflicts", entries: conflicts, snippets: resolved };
  }
  return { kind: "confirm", snippets: resolved };
}

const STEP_FOR_ROUTING: Record<StepRouting["kind"], WizardStep> = {
  "review-placeholders": 2,
  "review-conflicts": 3,
  confirm: 4,
};

/**
 * How many snippets an import will actually import.
 *
 * "The incoming snippets that survive", which is what the user reads the button as
 * saying. Every parsed snippet gets imported unless its conflict resolved to
 * `"skip"` — an `"overwrite"` still results in the snippet existing (with the
 * incoming content), and a `"rename"` is a new snippet.
 *
 * **Not** "rows in the final list whose id is new". That looks equivalent and is
 * not: when a conflict is on the *id* rather than the shortcut, an overwrite
 * rewrites that same id, so a new-id count reports 0 for an import that visibly
 * replaced a snippet — and the button, disabled at 0, stops working. The e2e
 * caught it. Checked against the component's previous formula
 * (`final - existing + overwriteCount`) across no-conflict, shortcut overwrite, id
 * overwrite, skip, rename and mixtures: they agree in every case, so this is one
 * expression replacing two rather than a fix for a wrong number.
 */
export function countImported(
  parsed: readonly ParsedSnippet[],
  conflicts: readonly ConflictEntry[]
): number {
  const skipped = new Set(
    conflicts
      .filter((c) => c.resolution === "skip")
      .map((c) => c.incoming.suggestedId)
  );
  return parsed.filter((s) => !skipped.has(s.suggestedId)).length;
}

/** The snippets an import would write. */
export function previewFinalSnippets(
  existing: readonly Snippet[],
  parsed: readonly ParsedSnippet[],
  conflicts: readonly ConflictEntry[]
): Snippet[] {
  return buildFinalSnippets(
    [...existing],
    [...parsed],
    [...conflicts]
  ) as Snippet[];
}

/**
 * Whether this import will push the library over the sync warning line.
 *
 * `false` in local mode: local storage has no sync quota, so warning about one
 * would be noise. The number is compared against the *whole* library, because
 * that is what the quota applies to — comparing only the incoming snippets would
 * miss a library already at the ceiling.
 */
export function willExceedQuota(
  existing: readonly Snippet[],
  parsed: readonly ParsedSnippet[],
  conflicts: readonly ConflictEntry[],
  storageMode: "sync" | "local"
): boolean {
  if (storageMode === "local") return false;
  const estimated = estimate(previewFinalSnippets(existing, parsed, conflicts));
  return estimated > SYNC_QUOTA.WARN_AT;
}

function estimate(snippets: Snippet[]): number {
  return estimateJsonSize(snippets);
}

// ---------------------------------------------------------------------------
// Store transitions
// ---------------------------------------------------------------------------

/** Load the library and the storage mode, for conflict detection and the quota. */
export async function initialiseImport(): Promise<void> {
  const [snippets, status] = await Promise.allSettled([
    getSnippets(),
    getStorageStatus(),
  ]);
  importStore.setState((prev) => ({
    ...prev,
    existingSnippets: snippets.status === "fulfilled" ? snippets.value : [],
    storageMode:
      status.status === "fulfilled" && status.value.mode === "local"
        ? "local"
        : "sync",
  }));
}

/** Route out of step 1 and apply the result. */
export function advanceFromUpload(): void {
  const { parsedSnippets, existingSnippets } = importStore.state;
  const routing = routeAfterUpload(parsedSnippets, existingSnippets);
  if (routing.kind === "review-placeholders") {
    importStore.setState((prev) => ({
      ...prev,
      unsupportedEntries: routing.entries,
      step: STEP_FOR_ROUTING[routing.kind],
    }));
    return;
  }
  enterConflictsOrConfirm(routing);
}

/** Route out of step 2 and apply the result. */
export function advanceFromPlaceholders(): void {
  const { parsedSnippets, unsupportedEntries, existingSnippets } =
    importStore.state;
  const routing = routeAfterPlaceholders(
    parsedSnippets,
    unsupportedEntries,
    existingSnippets
  );
  if (routing.kind === "review-placeholders") {
    // Unreachable — `routeAfterPlaceholders` never returns this. Guarded so a
    // future edit cannot leave the wizard on a step it has already passed.
    importStore.setState((prev) => ({ ...prev, step: 2 }));
    return;
  }
  enterConflictsOrConfirm(routing);
}

function enterConflictsOrConfirm(
  routing: Exclude<StepRouting, { kind: "review-placeholders" }>
): void {
  importStore.setState((prev) => ({
    ...prev,
    // The list the conflicts were detected against, so the two can never describe
    // different snippets.
    parsedSnippets: [...routing.snippets],
    conflictEntries: routing.kind === "review-conflicts" ? routing.entries : [],
    step: STEP_FOR_ROUTING[routing.kind],
  }));
}

/** Whether step 1's Next button is enabled. */
export function canAdvanceFromUpload(state: ImportState): boolean {
  return (
    state.parsedSnippets.length > 0 &&
    !state.parseError &&
    !!state.selectedFormat
  );
}

/** Whether a parsed format has a parser to name. */
export function detectedParserLabel(
  detected: FormatId | null
): ReturnType<typeof getParser> {
  return detected ? getParser(detected) : undefined;
}

// ---------------------------------------------------------------------------
// The import itself
// ---------------------------------------------------------------------------

/**
 * Write the library, and report how many snippets were added.
 *
 * Media blobs from a ZIP are saved first and each is saved independently: one
 * corrupt entry must not abandon the rest of the archive, and the snippet text is
 * still worth importing without it. A partial failure is reported and the import
 * continues.
 *
 * Returns the count, or `null` on failure. `null` rather than `0` so a caller
 * cannot mistake "the write failed" for "there was nothing to import".
 */
export async function runImport(): Promise<number | null> {
  const {
    existingSnippets,
    parsedSnippets,
    conflictEntries,
    zipMediaBlobs,
    isZipImport,
  } = importStore.state;

  importStore.setState((prev) => ({
    ...prev,
    importing: true,
    importError: null,
  }));
  // Dedup can collapse two ids onto one stored blob. Remember the surviving id
  // so the snippets saved below never point at an id that was not kept.
  const restoredIds = new Map<string, string>();
  try {
    if (isZipImport && zipMediaBlobs.size > 0) {
      const { restoreMediaEntry } = await import("@/storage/backends/media");
      let savedCount = 0;
      for (const [id, { blob, meta }] of zipMediaBlobs) {
        try {
          restoredIds.set(id, await restoreMediaEntry({ ...meta, id, blob }));
          savedCount++;
        } catch (error) {
          captureError(error, { action: "importZipMedia", mediaId: id });
        }
      }
      // Reported as one event rather than only as per-entry errors. A user who
      // imports a 200-image archive and loses 3 of them would otherwise see
      // nothing at all: the import succeeds, the snippets import, and three
      // images are silently broken. The count says how much was lost.
      if (savedCount < zipMediaBlobs.size) {
        captureMessage(
          "ZIP import: some media blobs failed to save",
          "warning",
          {
            saved: savedCount,
            total: zipMediaBlobs.size,
          }
        );
      }
    }

    const finalSnippets = previewFinalSnippets(
      existingSnippets,
      parsedSnippets,
      conflictEntries
    ).map((snippet) => ({
      ...snippet,
      content: remapMediaIds(snippet.content, restoredIds),
    }));
    await bulkSaveSnippets(finalSnippets);
    const count = countImported(parsedSnippets, conflictEntries);
    importStore.setState((prev) => ({
      ...prev,
      importing: false,
      importDone: true,
      importedCount: count,
    }));
    return count;
  } catch (error) {
    console.error("[Clipio] Import failed:", error);
    captureError(error, { action: "importSnippets" });
    importStore.setState((prev) => ({
      ...prev,
      importing: false,
      importError:
        error instanceof Error
          ? error.message
          : i18n.t("importWizard.confirm.failedToImport"),
    }));
    return null;
  }
}

// ---------------------------------------------------------------------------
// Reset
// ---------------------------------------------------------------------------

/**
 * Return to step 1 for a fresh import.
 *
 * Called when the wizard closes. Without it, reopening the wizard resumed
 * halfway with the previous file's snippets loaded — the component's own
 * `useState` initialisers only ran on mount, and the wizard is often kept mounted
 * behind a dialog.
 */
export function resetImport(): void {
  importStore.setState(() => ({
    step: 1,
    existingSnippets: importStore.state.existingSnippets,
    storageMode: importStore.state.storageMode,
    isDragging: false,
    fileName: null,
    rawJson: null,
    detectedFormat: null,
    selectedFormat: "",
    parseError: null,
    parsedSnippets: [],
    unsupportedEntries: [],
    conflictEntries: [],
    importing: false,
    importDone: false,
    importedCount: 0,
    importError: null,
    isZipImport: false,
    zipMediaCount: 0,
    zipMissingMediaWarning: null,
    zipMediaBlobs: new Map(),
  }));
}

// ---------------------------------------------------------------------------
// React bindings
// ---------------------------------------------------------------------------

/** Subscribe to one slice of the import store. */
export function useImport<T>(selector: (state: ImportState) => T): T {
  return useStore(importStore, selector);
}
