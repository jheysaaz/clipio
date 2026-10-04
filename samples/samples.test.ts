import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { detectFormat } from "@/lib/importers/detect";
import { IMPORT_PARSERS, getParser } from "@/lib/importers/registry";
import { validateImportedSnippet } from "@/lib/snippet-schema";
import { createSnippet } from "@/types";

/**
 * Every file in `samples/` must survive the real import path.
 *
 * A sample that fails to detect, or whose snippets fail schema validation, is
 * worse than no sample at all: the person testing concludes the importer is
 * broken. So these are checked by the same code the wizard runs, not by eye.
 */

const FILES = [
  { file: "clipio-export.json", format: "clipio" },
  { file: "textblaze-export.json", format: "textblaze" },
  { file: "powertext-export.json", format: "powertext" },
] as const;

function load(name: string): unknown {
  return JSON.parse(readFileSync(`samples/${name}`, "utf8"));
}

describe("samples/", () => {
  for (const { file, format } of FILES) {
    it(`${file} is detected as ${format}`, () => {
      expect(detectFormat(load(file))).toBe(format);
    });

    it(`${file} parses into snippets`, () => {
      const parser = getParser(format);
      if (!parser) throw new Error(`no parser for ${format}`);
      expect(parser.canParse(load(file))).toBe(true);
      const parsed = parser.parse(load(file));
      expect(parsed.length).toBeGreaterThan(0);
      for (const snippet of parsed) {
        expect(snippet.label.length, "label").toBeGreaterThan(0);
        expect(snippet.shortcut.length, "shortcut").toBeGreaterThan(0);
        expect(snippet.content.length, "content").toBeGreaterThan(0);
      }
    });

    it(`${file} survives schema validation once stored`, () => {
      // The wizard writes these through `createSnippet` + storage, which runs the
      // shared validator. A sample that would be rejected on the way in is not a
      // usable sample.
      const parser = getParser(format);
      if (!parser) throw new Error(`no parser for ${format}`);
      for (const parsed of parser.parse(load(file))) {
        const stored = createSnippet({
          label: parsed.label,
          shortcut: parsed.shortcut,
          content: parsed.content,
          tags: parsed.tags,
        });
        // `validateImportedSnippet` rather than the boolean predicate, so a
        // failure says which bound was broken instead of just "false".
        const result = validateImportedSnippet(stored);
        expect(
          result.ok ? true : `${file}: ${parsed.label} — ${result.reason}`,
          `${file}: ${parsed.label}`
        ).toBe(true);
      }
    });
  }

  it("maps Power Text placeholders to Clipio's", () => {
    const parser = getParser("powertext");
    if (!parser) throw new Error("no powertext parser");
    const parsed = parser.parse(load("powertext-export.json"));
    // Keyed by the object's key, which becomes the shortcut: Power Text has no
    // separate name field, so the label is the shortcut too.
    const byShortcut = new Map(parsed.map((s) => [s.shortcut, s]));

    expect(byShortcut.get(";pw")?.content).toBe("Kind regards,\n{{clipboard}}");
    // `%d(...)` is consumed whole, trailing `%` and all — asserting the exact
    // string, so a leftover character from a half-matched placeholder shows up
    // here rather than in someone's inserted text.
    expect(byShortcut.get(";date")?.content).toBe("Date: {{date:iso}}");
    expect(byShortcut.get(";usdate")?.content).toBe("Date: {{date:us}}");
    expect(byShortcut.get(";longdate")?.content).toBe("Date: {{date:long}}");
  });

  it("maps TextBlaze placeholders and flags the ones it cannot", () => {
    const parser = getParser("textblaze");
    if (!parser) throw new Error("no textblaze parser");
    const parsed = parser.parse(load("textblaze-export.json"));

    const withCursor = parsed.find((s) => s.shortcut === ";tso");
    expect(withCursor?.content).toContain("{{cursor}}");

    // Folder names become tags, slugified and lowercased, alongside the source
    // format's own tag.
    expect(parsed.find((s) => s.shortcut === ";tcm")?.tags).toEqual(
      expect.arrayContaining(["text_blaze", "development"])
    );

    // `{accountNumber}` and `{ref}` have no Clipio equivalent, so they must be
    // reported as unsupported rather than silently dropped. This is the one
    // thing worth eyeballing in the wizard: the conflict step should offer a
    // choice for this snippet.
    const unsupported = parsed.find((s) => s.shortcut === ";tup");
    expect(unsupported?.unsupportedPlaceholders).toContain("{accountNumber}");
  });

  it("keeps every registered format covered by a sample", () => {
    // A new parser with no sample is a parser nobody has manually exercised.
    const covered = new Set(FILES.map((f) => f.format));
    for (const parser of IMPORT_PARSERS) {
      expect(covered.has(parser.id), `no sample for ${parser.id}`).toBe(true);
    }
  });
});
