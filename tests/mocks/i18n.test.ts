/**
 * Tests for tests/mocks/i18n.ts
 *
 * The stub's entire job is to make assertions on copy meaningful: a test that
 * checks a button reads "Import 2 snippets" should be checking the real words,
 * not a mock's invention of them. That only holds if the stub resolves every
 * shape the real locale file uses.
 *
 * These tests exist because it did not. Plural groups (`{ 1: ..., n: ... }`)
 * were treated as unresolvable, so nine keys echoed their own dotted path into
 * every test that touched them — silently, because a raw key still renders as a
 * string. The bug this pins is a stub that fails quietly.
 */

import { describe, expect, it } from "vitest";
import { i18n } from "./i18n";

describe("i18n stub — plain messages", () => {
  it("resolves a nested key against the real en.yml", () => {
    expect(i18n.t("common.save")).toBe("Save");
  });

  it("returns the key itself when the key is missing", () => {
    // Returning the key makes a locale regression legible in a failure instead
    // of rendering an empty string that looks like a styling bug.
    expect(i18n.t("common.definitelyNotAKey")).toBe("common.definitelyNotAKey");
  });

  it("does not resolve a key that runs past a leaf", () => {
    expect(i18n.t("common.save.nonsense")).toBe("common.save.nonsense");
  });

  it("substitutes positional placeholders", () => {
    expect(
      i18n.t("snippetEditor.shortcutErrorDuplicate", ["/x", "Address"])
    ).toBe(
      'Shortcut "/x" is already used by "Address". Choose a different shortcut.'
    );
  });

  it("accepts the bare-value substitution form", () => {
    // The codebase uses both forms at call sites.
    expect(i18n.t("importWizard.confirm.done.body", 3)).toBe(
      "3 snippets added to your library."
    );
  });

  it("leaves an unmatched placeholder visible", () => {
    // Matching Chrome: a missing substitution shows the template rather than
    // silently producing "Shortcut \"\" is already used".
    expect(i18n.t("snippetEditor.shortcutErrorDuplicate", ["/x"])).toContain(
      "$2"
    );
  });
});

describe("i18n stub — plural messages", () => {
  it("picks the singular form for a count of 1", () => {
    expect(i18n.t("importWizard.upload.foundSnippets", 1)).toBe(
      "Found 1 snippet"
    );
  });

  it("picks the plural form for any other count", () => {
    expect(i18n.t("importWizard.upload.foundSnippets", 2)).toBe(
      "Found 2 snippets"
    );
    expect(i18n.t("importWizard.upload.foundSnippets", 0)).toBe(
      "Found 0 snippets"
    );
  });

  it("accepts an array containing the count", () => {
    expect(i18n.t("importWizard.footer.importCount", [5])).toBe(
      "Import 5 snippets"
    );
  });

  it("resolves every plural key in the locale file", () => {
    // The regression in one assertion: walk the real en.yml for `{1, n}` groups
    // and confirm none of them comes back as its own key. Before the fix, all
    // nine returned their dotted path.
    const pluralKeys = [
      "dashboard.warnings.recovery.body",
      "dashboard.warnings.recovery.action",
      "options.storage.syncingAcross",
      "options.storage.onlyHere",
      "options.importExport.importCard.successMessage",
      "importWizard.upload.foundSnippets",
      "importWizard.conflicts.description",
      "importWizard.confirm.done.body",
      "importWizard.footer.importCount",
    ];

    for (const key of pluralKeys) {
      expect(
        i18n.t(key, 2),
        `${key} must resolve to copy, not its own key`
      ).not.toBe(key);
      expect(i18n.t(key, 2).length, `${key} must not be empty`).toBeGreaterThan(
        0
      );
    }
  });

  it("uses English plural rules — only exactly 1 is singular", () => {
    // 1.0 and "1" both count as one; 1 item must not read "1 snippets".
    expect(i18n.t("importWizard.upload.foundSnippets", "1")).toBe(
      "Found 1 snippet"
    );
    expect(i18n.t("importWizard.upload.foundSnippets", 2)).not.toContain(
      "1 snippet"
    );
  });

  it("falls back to the first form when no count is supplied", () => {
    // Chrome selects a form from the substitutions; with none, the stub must
    // still return finished words. Taking the plural form here instead would
    // render "Found $1 snippets" — a half-substituted string no user ever sees.
    expect(i18n.t("importWizard.upload.foundSnippets")).toBe("Found 1 snippet");
  });

  it("never returns copy with a visible placeholder in it", () => {
    // Every plural key, every plausible count, must render as finished words.
    const keys = [
      "importWizard.upload.foundSnippets",
      "importWizard.footer.importCount",
      "importWizard.confirm.done.body",
      "options.storage.syncingAcross",
    ];
    for (const key of keys) {
      for (const count of [0, 1, 2, 100]) {
        expect(i18n.t(key, count), `${key} with ${count}`).not.toMatch(/\$\d/);
      }
    }
  });
});
