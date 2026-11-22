/**
 * Tests for the settings registry and its search ranking.
 *
 */

import { describe, it, expect } from "vitest";
import {
  SECTIONS,
  SETTINGS,
  SECTION_LABEL_KEYS,
  settingsForSection,
  getSection,
  getSetting,
} from "./registry";
import { searchRegistryEntries, _resetSearchIndexCache } from "./search";

// ---------------------------------------------------------------------------
// Registry shape
// ---------------------------------------------------------------------------

describe("registry shape", () => {
  it("gives every setting a unique id", () => {
    const ids = SETTINGS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every setting a unique test handle", () => {
    const ids = SETTINGS.map((s) => s.testId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every setting a unique locale key pair", () => {
    const keys = SETTINGS.map((s) => `${s.titleKey}|${s.descKey}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  // Negative: an entry pointing at a section that does not exist would be
  // unrenderable, so the sidebar could offer a route with no rows.
  it("references only sections that exist", () => {
    const sectionIds = new Set(SECTIONS.map((s) => s.id));
    const orphans = SETTINGS.filter((s) => !sectionIds.has(s.section));
    expect(orphans.map((s) => s.id)).toEqual([]);
  });

  it("gives every settings-driven section at least one setting", () => {
    // Library and About are `kind: "content"` — media/usage/version surfaces
    // with no preferences — so they are legitimately rowless.
    const empty = SECTIONS.filter(
      (s) => s.kind === "settings" && settingsForSection(s.id).length === 0
    );
    expect(empty.map((s) => s.id)).toEqual([]);
  });

  it("keeps every content section out of the settings index", () => {
    const contentIds = SECTIONS.filter((s) => s.kind === "content").map(
      (s) => s.id
    );
    expect(contentIds.length).toBeGreaterThan(0);
    for (const id of contentIds) {
      expect(settingsForSection(id)).toEqual([]);
    }
  });

  it("provides select options only where the control is a select", () => {
    const missing = SETTINGS.filter(
      (s) => s.control === "select" && !s.options?.length
    );
    expect(missing.map((s) => s.id)).toEqual([]);
  });

  // empty radiogroup, and one without icons renders three unlabelled buttons
  // that only their text can distinguish.
  it("gives every icon-segment both options and an icon per option", () => {
    const segments = SETTINGS.filter((s) => s.control === "icon-segment");
    expect(segments.length).toBeGreaterThan(0);

    for (const entry of segments) {
      expect(
        entry.options?.length,
        `${entry.id} has no options`
      ).toBeGreaterThan(0);
      const withoutIcon = (entry.options ?? []).filter((o) => !o.icon);
      expect(
        withoutIcon.map((o) => o.value),
        `${entry.id} has options with no icon`
      ).toEqual([]);
    }
  });

  // — optionFonts is what makes a font picker show
  // each face in itself. An entry that declares it must cover every option, or
  // one row would preview in its own face and the rest in the default.
  it("gives every option a preview face where optionFonts is declared", () => {
    const withFonts = SETTINGS.filter((s) => s.optionFonts !== undefined);
    expect(withFonts.length).toBeGreaterThan(0);

    for (const entry of withFonts) {
      const keys = Object.keys(entry.optionFonts ?? {});
      const values = (entry.options ?? []).map((o) => o.value);
      expect(keys.sort(), `${entry.id} preview coverage`).toEqual(
        [...values].sort()
      );
      // A preview family that is empty would silently fall back and render every
      // label identically.
      for (const [value, family] of Object.entries(entry.optionFonts ?? {})) {
        expect(family.trim(), `${entry.id}.${value} is blank`).not.toBe("");
      }
    }
  });

  it("provides a range only where the control is a slider", () => {
    const stray = SETTINGS.filter(
      (s) => s.control !== "slider" && s.range !== undefined
    );
    expect(stray.map((s) => s.id)).toEqual([]);
  });

  it("maps every section id to a nav label key that exists", () => {
    // Section ids are kebab-case because they appear in the URL hash, so the
    // label lookup goes through SECTION_LABEL_KEYS. A missing entry would make
    // i18n.t receive undefined at render time.
    for (const section of SECTIONS) {
      expect(SECTION_LABEL_KEYS[section.id]).toBeDefined();
      expect(section.labelKey).toBe(SECTION_LABEL_KEYS[section.id]);
    }
  });

  it("gives every search result a resolvable section label", () => {
    for (const entry of SETTINGS) {
      expect(SECTION_LABEL_KEYS[entry.section]).toBeDefined();
    }
  });
});

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------

describe("lookups", () => {
  it("finds a setting by id", () => {
    const confetti = getSetting("confetti");
    expect(confetti?.control).toBe("switch");
    expect(confetti?.preview?.testId).toBe("confetti-preview");
  });

  it("returns undefined for an unknown setting", () => {
    expect(getSetting("nope")).toBeUndefined();
  });

  it("finds a section by id", () => {
    expect(getSection("appearance")?.labelKey).toBe("options.nav.appearance");
  });

  it("returns only the settings belonging to a section", () => {
    const appearance = settingsForSection("appearance");
    expect(appearance.map((s) => s.id).sort()).toEqual([
      "confetti",
      "font-family",
      "theme",
    ]);
  });
});

describe("section taxonomy", () => {
  it("exposes Images as its own section", () => {
    // Images was folded into Library, then split back out: the media list has
    // its own storage meter and per-row actions and was hard to find.
    expect(SECTIONS.some((s) => s.id === "images")).toBe(true);
    expect(SECTION_LABEL_KEYS.images).toBe("options.nav.images");
  });

  it("keeps Images in the Library group", () => {
    const images = getSection("images");
    const library = getSection("library");
    expect(images?.groupKey).toBe(library?.groupKey);
  });

  it("does not give the Images section any registry rows", () => {
    // It is a management surface, so it renders a panel instead.
    expect(getSection("images")?.kind).toBe("content");
    expect(settingsForSection("images")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Search, against the real registry
// ---------------------------------------------------------------------------
//
// The ranking itself is covered in src/lib/setting-index.test.ts with synthetic
// entries. These tests exist because that file cannot catch the wiring failing:
// it proves nothing about whether the copy the user actually reads — resolved
// from the real en.yml, not a fixture — reaches the index.
//
// `#i18n` is aliased in vitest.config.ts to a stub reading the real en.yml, so
// the assertions below are made against real user-visible strings.

const ids = (query: string) =>
  searchRegistryEntries(query).map((r) => r.entry.id);

describe("searchRegistryEntries — real registry", () => {
  it("finds the appearance font setting by an option label", () => {
    // The case that motivated the index. "OpenDyslexic" is rendered inside the
    // font select on the Appearance section; the previous search scored the i18n
    // key name instead of the copy, so this returned nothing.
    expect(ids("opendyslexic")).toContain("font-family");
  });

  it("finds it by the option label spelled as separate words", () => {
    // "OpenDyslexic" is one token to a tokenizer, so this only resolves because
    // camel-cased runs are indexed whole *and* by part.
    expect(ids("open dyslexic")).toContain("font-family");
  });

  it("finds it by a font family that appears in no label", () => {
    expect(ids("segoe")).toContain("font-family");
  });

  it("finds a setting by a word that only appears in its description", () => {
    // Descriptions were never indexed before.
    expect(ids("filterable")).toContain("preview-enabled");
  });

  it("finds a setting by its section label", () => {
    expect(ids("appearance")).toContain("font-family");
  });

  it("finds a setting by its hand-authored keyword", () => {
    expect(ids("quota")).toContain("storage-mode");
  });

  it("returns results ordered best-first, matching what the old ranking promised", () => {
    // An exact id must still beat everything, which is the one guarantee the
    // previous implementation made that users would have noticed losing.
    expect(ids("theme")[0]).toBe("theme");
    expect(ids("confetti")[0]).toBe("confetti");
  });

  it("returns nothing for an empty query", () => {
    expect(searchRegistryEntries("")).toEqual([]);
  });

  it("returns nothing for a punctuation-only query", () => {
    // The caller shows every setting on an empty query and a no-results message
    // otherwise, so this must not read as "everything matches".
    expect(searchRegistryEntries("-")).toEqual([]);
  });

  it("returns nothing for a query that matches no setting", () => {
    expect(ids("zzzzqqq")).toEqual([]);
  });

  it("reports no title highlight when the match was on an option label", () => {
    // The row renders the title. Reporting a range here would underline the
    // wrong characters, so the index returns none rather than guessing.
    const [result] = searchRegistryEntries("opendyslexic");
    expect(result.titleHits).toEqual([]);
  });

  it("reports a title highlight when the match was on the title", () => {
    const [result] = searchRegistryEntries("confetti");
    expect(result.titleHits).toHaveLength(1);
    const title = result.entry.titleKey;
    expect(title).toBeTruthy();
  });

  it("does not repeat work when called twice with the same memoised index", () => {
    // The index is cached at module load. A second call must produce identical
    // output rather than rebuilding and re-resolving every key.
    _resetSearchIndexCache();
    const first = ids("opendyslexic");
    const second = ids("opendyslexic");
    expect(second).toEqual(first);
  });

  it("resolves every result back to a registered setting", () => {
    // A result index could name a setting that no longer exists; the resolver
    // drops those rather than handing a row a missing entry.
    for (const query of ["a", "e", "se", "on", "in"]) {
      for (const { entry } of searchRegistryEntries(query)) {
        expect(getSetting(entry.id)).toBe(entry);
      }
    }
  });
});
