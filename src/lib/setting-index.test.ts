import { describe, it, expect } from "vitest";

import {
  buildSettingIndex,
  searchSettingIndex,
  type IndexableSetting,
} from "./setting-index";
import { foldText } from "./text-fold";

/**
 * These tests use synthetic entries rather than the real `SETTINGS` array.
 *
 * The registry's contents change whenever a setting is added, which would make
 * assertions like "this query returns exactly one result" silently start
 * testing something else. Synthetic entries let each test state the exact
 * ranking relationship it is about, and they prove the module resolves copy
 * through the `t` it is handed instead of reaching for a global.
 */

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SECTION_LABELS: Record<string, string> = {
  appearance: "Appearance",
  expansion: "Expansion",
  storage: "Storage",
};

/** Resolves a key by stripping a `copy:` prefix, so tests can spot untranslated keys. */
const t = (key: string) => key.replace(/^copy:/, "");

const FONT: IndexableSetting = {
  id: "font-family",
  section: "appearance",
  titleKey: "copy:Interface font",
  descKey: "copy:The typeface Clipio uses everywhere.",
  control: "select",
  keywords: ["typography", "dyslexia"],
  options: [
    { value: "inter", labelKey: "copy:Inter" },
    { value: "system", labelKey: "copy:System" },
    { value: "dyslexic", labelKey: "copy:OpenDyslexic" },
  ],
  optionFonts: {
    inter: "InterVariable, system-ui, sans-serif",
    system: 'system-ui, -apple-system, "Segoe UI", sans-serif',
    dyslexic: "OpenDyslexic, system-ui, sans-serif",
  },
};

const PREVIEW: IndexableSetting = {
  id: "preview-enabled",
  section: "expansion",
  titleKey: "copy:Snippet preview",
  descKey: "copy:Show a filterable menu as you type.",
  control: "switch",
  keywords: ["autocomplete", "suggest"],
};

const STORAGE: IndexableSetting = {
  id: "storage-mode",
  section: "storage",
  titleKey: "copy:Where snippets are stored",
  descKey: "copy:Sync keeps snippets on every device.",
  control: "select",
  keywords: ["cloud", "backup"],
  options: [
    { value: "sync", labelKey: "copy:Sync" },
    { value: "local", labelKey: "copy:Local" },
  ],
};

const index = buildSettingIndex([FONT, PREVIEW, STORAGE], SECTION_LABELS, t);

const ids = (query: string, over = index) =>
  searchSettingIndex(over, query).map((m) => m.entry.id);

// ---------------------------------------------------------------------------
// Building
// ---------------------------------------------------------------------------

describe("buildSettingIndex", () => {
  it("resolves copy through the translator it is given", () => {
    // Guards against the module quietly importing i18n itself: if it did, this
    // hand-made translator would be bypassed and the keys would leak into the
    // index, where nothing would notice until search returned nothing.
    const font = index.find((e) => e.id === "font-family");
    const title = font?.fields.find((f) => f.kind === "title");
    expect(title?.text).toBe("Interface font");
  });

  it("indexes an option label as its own field", () => {
    const options = index
      .find((e) => e.id === "font-family")
      ?.fields.filter((f) => f.kind === "option")
      .map((f) => f.text);
    expect(options).toEqual(["Inter", "System", "OpenDyslexic"]);
  });

  it("indexes the font family behind each option", () => {
    // This is what makes "segoe" work: "Segoe UI" is rendered in the option's
    // own face but appears in no label text.
    const fonts = index
      .find((e) => e.id === "font-family")
      ?.fields.filter((f) => f.kind === "font")
      .map((f) => f.text);
    expect(fonts).toContain('system-ui, -apple-system, "Segoe UI", sans-serif');
  });

  it("omits option fields for a setting that offers none", () => {
    // A switch is fully indexed without them — a shorter index, not a broken one.
    const kinds = index
      .find((e) => e.id === "preview-enabled")
      ?.fields.map((f) => f.kind);
    expect(kinds).not.toContain("option");
    expect(kinds).not.toContain("font");
  });

  it("falls back to the raw section id when no label is supplied", () => {
    // An unmapped section still gets an indexed field rather than an empty
    // string, which would fold to zero words and be silently unsearchable.
    const orphan = buildSettingIndex(
      [{ ...PREVIEW, id: "orphan", section: "nowhere" }],
      SECTION_LABELS,
      t
    );
    expect(orphan[0].fields.find((f) => f.kind === "section")?.text).toBe(
      "nowhere"
    );
  });

  it("keeps every offset pointing at the original text", () => {
    // Offsets are what make highlighting safe around accents, and folding
    // changes length — "Temática" folds to "tematica", so a folded index cannot
    // be used to slice the original. Verified here against a field that
    // actually contains an accent, not a clean ASCII sample.
    const accented = buildSettingIndex(
      [{ ...PREVIEW, descKey: "copy:Temática y técnicas" }],
      SECTION_LABELS,
      t
    );
    const desc = accented[0].fields.find((f) => f.kind === "desc");
    expect(desc?.words.length).toBeGreaterThan(0);
    for (const word of desc?.words ?? []) {
      // The slice is the ORIGINAL (accented, original case); the folded form is
      // what gets compared. Asserting slice === word.text would be the bug.
      expect(foldText(desc!.text.slice(word.start, word.end))).toBe(word.text);
    }
    expect(desc?.words.map((w) => w.text)).toEqual([
      "tematica",
      "y",
      "tecnicas",
    ]);
  });
});

// ---------------------------------------------------------------------------
// Searching — the behaviour that was broken
// ---------------------------------------------------------------------------

describe("searchSettingIndex", () => {
  it("finds a setting by the option label the user can see", () => {
    // The bug this module exists to fix: "OpenDyslexic" is rendered inside the
    // font select and the old search indexed only the i18n key name, so this
    // returned nothing.
    expect(ids("opendyslexic")).toEqual(["font-family"]);
  });

  it("matches a multi-word option label across separate query tokens", () => {
    // Whole-query substring matching can never satisfy this: neither
    // "opendyslexic" nor "open dyslexic" appears as a substring of the other.
    expect(ids("open dyslexic")).toEqual(["font-family"]);
  });

  it("finds a setting by a font family name shown in no label", () => {
    expect(ids("segoe")).toEqual(["font-family"]);
  });

  it("finds a setting by the words in its description", () => {
    // The description was not indexed at all before.
    expect(ids("filterable")).toEqual(["preview-enabled"]);
  });

  it("finds a setting by a multi-word description", () => {
    expect(ids("every device")).toEqual(["storage-mode"]);
  });

  it("finds a setting by its section label", () => {
    expect(ids("appearance")).toEqual(["font-family"]);
  });

  it("finds a setting by its control name", () => {
    expect(ids("switch")).toEqual(["preview-enabled"]);
  });

  it("finds a setting by its hand-authored keyword", () => {
    expect(ids("autocomplete")).toEqual(["preview-enabled"]);
  });

  it("resolves copy containing diacritics from an unaccented query", () => {
    const accented = buildSettingIndex(
      [{ ...PREVIEW, descKey: "copy:Temática avanzada" }],
      SECTION_LABELS,
      t
    );
    expect(ids("tematica", accented)).toEqual(["preview-enabled"]);
    expect(ids("TEMÁTICA", accented)).toEqual(["preview-enabled"]);
  });
});

// ---------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------

describe("searchSettingIndex — ranking", () => {
  it("ranks an id match above a title match", () => {
    const two = buildSettingIndex(
      [
        { ...FONT, id: "segoe", titleKey: "copy:Unrelated heading" },
        { ...PREVIEW, id: "unrelated", titleKey: "copy:Segoe heading" },
      ],
      SECTION_LABELS,
      t
    );
    expect(ids("segoe", two)).toEqual(["segoe", "unrelated"]);
  });

  it("ranks a title match above an option-label match", () => {
    const two = buildSettingIndex(
      [
        {
          ...FONT,
          id: "a",
          options: [{ value: "x", labelKey: "copy:Widget" }],
        },
        { ...PREVIEW, id: "b", titleKey: "copy:Widget settings" },
      ],
      SECTION_LABELS,
      t
    );
    expect(ids("widget", two)).toEqual(["b", "a"]);
  });

  it("ranks an option-label match above a description mention", () => {
    // Same token, three different fields, deliberately given to three entries
    // so the ordering comes from SCORE alone and not from id tie-breaking.
    const two = buildSettingIndex(
      [
        {
          ...PREVIEW,
          id: "in-desc",
          control: "text",
          keywords: [],
          descKey: "copy:Widget behaviour",
        },
        {
          ...PREVIEW,
          id: "in-option",
          control: "select",
          keywords: [],
          descKey: "copy:Nothing here",
          options: [{ value: "w", labelKey: "copy:Widget" }],
        },
      ],
      SECTION_LABELS,
      t
    );
    expect(ids("widget", two)).toEqual(["in-option", "in-desc"]);
  });

  it("ranks a whole-word hit above a prefix hit in the same field", () => {
    // Typing "cloud" must prefer a setting named "Cloud" over one named
    // "Cloudflare" — the whole-word reading is the more deliberate match, even
    // though both live in the same field and would otherwise tie.
    const two = buildSettingIndex(
      [
        { ...FONT, id: "a", titleKey: "copy:Cloudflare sync", keywords: [] },
        { ...PREVIEW, id: "b", titleKey: "copy:Cloud", keywords: [] },
      ],
      SECTION_LABELS,
      t
    );
    expect(ids("cloud", two)).toEqual(["b", "a"]);
  });

  it("sums per-token scores so more matched tokens beat one strong hit", () => {
    // "preview" alone is a strong hit on preview-enabled. Both tokens landing
    // on font-family must still outrank it, because the user asked for two
    // things.
    expect(ids("interface opendyslexic")).toEqual(["font-family"]);
  });

  it("breaks ties by id so results are stable", () => {
    const two = buildSettingIndex(
      [
        { ...FONT, id: "zeta", titleKey: "copy:Shared heading" },
        { ...PREVIEW, id: "alpha", titleKey: "copy:Shared heading" },
      ],
      SECTION_LABELS,
      t
    );
    expect(ids("shared", two)).toEqual(["alpha", "zeta"]);
  });
});

// ---------------------------------------------------------------------------
// Highlighting
// ---------------------------------------------------------------------------

describe("searchSettingIndex — highlight ranges", () => {
  it("reports a range into the title for a title hit", () => {
    const [match] = searchSettingIndex(index, "interface");
    expect(match.hits).toHaveLength(1);
    const title = match.entry.fields.find((f) => f.kind === "title");
    // The range slices the ORIGINAL title, so it comes back with the original
    // capitalisation. The folded form is only ever compared, never rendered.
    expect(title?.text.slice(match.hits[0].start, match.hits[0].end)).toBe(
      "Interface"
    );
  });

  it("reports no highlight for a hit outside the title", () => {
    // A result row renders the title. Reporting a range for an option-label hit
    // would underline the wrong characters, so it reports none.
    const [match] = searchSettingIndex(index, "opendyslexic");
    expect(match.hits).toEqual([]);
  });

  it("points at the right characters when the title contains an accent", () => {
    const accented = buildSettingIndex(
      [{ ...PREVIEW, titleKey: "copy:Temática avanzada" }],
      SECTION_LABELS,
      t
    );
    const [match] = searchSettingIndex(accented, "tematica");
    const title = match.entry.fields.find((f) => f.kind === "title");
    // "Temática" is 8 characters; folding it to "tematica" is 8 too, but the
    // word starts at offset 0 and the token is 8 long — so the range must slice
    // back to the accented original, not to a folded string.
    expect(title?.text.slice(match.hits[0].start, match.hits[0].end)).toBe(
      "Temática"
    );
  });
});

// ---------------------------------------------------------------------------
// Negative cases
// ---------------------------------------------------------------------------

describe("searchSettingIndex — negative cases", () => {
  it("returns nothing for an empty or whitespace query", () => {
    // The caller renders "show every setting" on an empty result, so this must
    // not be confused with "nothing matched".
    expect(searchSettingIndex(index, "")).toEqual([]);
    expect(searchSettingIndex(index, "   ")).toEqual([]);
  });

  it("returns nothing for a query that is only punctuation", () => {
    // Same reason: a punctuation-only query must not read as a match-all.
    expect(searchSettingIndex(index, "-")).toEqual([]);
    expect(searchSettingIndex(index, "()")).toEqual([]);
  });

  it("returns nothing when one token of a multi-token query is absent", () => {
    // AND, not OR: a half-matching query would surface rows that answer only
    // part of what was asked.
    expect(ids("interface zzzzqqq")).toEqual([]);
  });

  it("returns nothing for a query matching no setting", () => {
    expect(ids("zzzzqqq")).toEqual([]);
  });

  it("does not match a mid-word fragment of a longer word", () => {
    // Whole-word and prefix matching only. `nterfac` is not a prefix of
    // "interface", so it matches nothing rather than half of it.
    expect(ids("nterfac")).toEqual([]);
  });

  it("searches only the index it is given", () => {
    const only = buildSettingIndex([PREVIEW], SECTION_LABELS, t);
    expect(ids("opendyslexic", only)).toEqual([]);
    expect(ids("autocomplete", only)).toEqual(["preview-enabled"]);
  });

  it("returns nothing for an empty index", () => {
    expect(searchSettingIndex([], "interface")).toEqual([]);
  });
});
