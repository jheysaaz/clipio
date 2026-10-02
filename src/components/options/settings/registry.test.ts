/**
 * Tests for the settings registry and its search ranking.
 *
 * spec: specs/options-redesign.spec.md
 */

import { describe, it, expect } from "vitest";
import {
  SECTIONS,
  SETTINGS,
  SECTION_LABEL_KEYS,
  searchSettings,
  settingsForSection,
  getSection,
  getSetting,
  normalizeQuery,
  type SettingEntry,
} from "./registry";

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
    expect(getSetting("confetti")?.control).toBe("switch");
  });

  it("returns undefined for an unknown setting", () => {
    expect(getSetting("nope")).toBeUndefined();
  });

  it("finds a section by id", () => {
    expect(getSection("appearance")?.labelKey).toBe(
      "options.nav.appearance"
    );
  });

  it("returns only the settings belonging to a section", () => {
    const appearance = settingsForSection("appearance");
    expect(appearance.map((s) => s.id).sort()).toEqual(["confetti", "theme"]);
  });
});

/** Result ids, for readable ranking assertions. */
const byId = (entries: SettingEntry[]) => entries.map((e) => e.id);

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
// normalizeQuery
// ---------------------------------------------------------------------------

describe("normalizeQuery", () => {
  it("lowercases and trims", () => {
    expect(normalizeQuery("  CoNFeTTi ")).toBe("confetti");
  });

  it("folds diacritics so unaccented queries still match", () => {
    expect(normalizeQuery("temática")).toBe("tematica");
  });

  it("matches an accented keyword from an unaccented query", () => {
    // The point of the fold: a Spanish user typing "tematica" must reach a
    // keyword written "temática", and the reverse must also hold.
    const synthetic: SettingEntry = {
      ...SETTINGS[0],
      id: "synthetic",
      keywords: ["temática"],
    };
    expect(byId(searchSettings("tematica", [synthetic]))).toEqual(["synthetic"]);
    expect(byId(searchSettings("TEMÁTICA", [synthetic]))).toEqual([
      "synthetic",
    ]);
  });
});

// ---------------------------------------------------------------------------
// searchSettings
// ---------------------------------------------------------------------------

describe("searchSettings", () => {
  it("returns nothing for an empty query so callers can show everything", () => {
    expect(searchSettings("")).toEqual([]);
    expect(searchSettings("   ")).toEqual([]);
  });

  it("finds a setting by its id", () => {
    expect(byId(searchSettings("confetti"))).toContain("confetti");
  });

  it("finds a setting by a keyword absent from its title", () => {
    // "hotkey" appears only in the shortcut entry's keywords.
    expect(byId(searchSettings("hotkey"))).toContain("preview-shortcut");
  });

  it("is case-insensitive", () => {
    expect(byId(searchSettings("CONFETTI"))).toEqual(
      byId(searchSettings("confetti"))
    );
  });

  // Ranking: a prefix on the id must beat a keyword that merely contains it.
  it("ranks an id prefix above a keyword substring", () => {
    const results = byId(searchSettings("theme"));
    expect(results[0]).toBe("theme");
  });

  it("breaks ties between equally-ranked matches by id", () => {
    // "preview" prefixes three ids equally; order must be stable, not
    // insertion-dependent.
    const results = byId(searchSettings("preview"));
    expect(results[0]).toBe("preview-enabled");
    expect([...results].sort()).toEqual(results);
  });

  it("does not match every setting on a single bare letter", () => {
    // A one-character query must not return the whole registry — that is what
    // makes the list useless rather than merely long.
    expect(byId(searchSettings("p")).length).toBeLessThan(SETTINGS.length);
  });

  // Negative: a query that matches nothing must yield nothing, not everything.
  it("returns an empty array when nothing matches", () => {
    expect(searchSettings("zzzzqqq")).toEqual([]);
  });

  it("searches only the supplied entries", () => {
    const subset = SETTINGS.filter((s) => s.id === "confetti");
    expect(byId(searchSettings("theme", subset))).toEqual([]);
    expect(byId(searchSettings("confetti", subset))).toEqual(["confetti"]);
  });
});