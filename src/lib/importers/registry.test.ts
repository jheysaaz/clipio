import { describe, it, expect } from "vitest";

import { IMPORT_PARSERS, getParser } from "./registry";
import { ClipioParser } from "./clipio";
import { TextBlazeParser } from "./textblaze";
import { PowerTextParser } from "./powertext";

/**
 * The registry exists so the import wizard and the options page's
 * supported-formats row cannot disagree about which formats Clipio accepts.
 * These tests pin the two properties that make that guarantee hold: every
 * format id is registered exactly once, and every registered parser carries an
 * icon the UI can render.
 */

describe("IMPORT_PARSERS", () => {
  it("lists every supported format, in presentation order", () => {
    expect(IMPORT_PARSERS.map((p) => p.id)).toEqual([
      "clipio",
      "textblaze",
      "powertext",
    ]);
  });

  it("registers the same parser instances the wizard imports directly", () => {
    // Guards against the registry drifting into its own copies. The wizard
    // special-cases ClipioParser for zip import, so a duplicate here would
    // parse differently from what it writes.
    expect(IMPORT_PARSERS).toContain(ClipioParser);
    expect(IMPORT_PARSERS).toContain(TextBlazeParser);
    expect(IMPORT_PARSERS).toContain(PowerTextParser);
  });

  it("registers each format id exactly once", () => {
    const ids = IMPORT_PARSERS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every parser a display name and an icon URL", () => {
    // Both are rendered unconditionally by LibraryPanel. A parser missing
    // either would silently produce an empty chip rather than fail loudly, so
    // the requirement is asserted here instead.
    for (const parser of IMPORT_PARSERS) {
      expect(parser.displayName, `${parser.id} displayName`).toBeTruthy();
      expect(parser.iconUrl, `${parser.id} iconUrl`).toBeTruthy();
    }
  });
});

describe("getParser", () => {
  it("resolves each registered format id to its parser", () => {
    expect(getParser("clipio")).toBe(ClipioParser);
    expect(getParser("textblaze")).toBe(TextBlazeParser);
    expect(getParser("powertext")).toBe(PowerTextParser);
  });

  it("returns undefined for an unregistered id", () => {
    // The signature is FormatId, so this is the runtime guard for a caller
    // holding a value that came from storage or a stale message rather than
    // the union. The wizard relies on this rather than throwing.
    expect(
      getParser("not-a-format" as Parameters<typeof getParser>[0])
    ).toBeUndefined();
  });
});

describe("third-party brand icons are bundled, not public paths", () => {
  it("resolves TextBlaze and PowerText icons through the bundler", () => {
    // These two marks moved from public/icon/ to src/assets/brands/ so they get
    // content-hashed URLs. A regression to a "/icon/…png" literal would point at
    // a file that no longer exists in the build output, and the img would fail
    // silently because both call sites pass alt="".
    expect(TextBlazeParser.iconUrl).not.toMatch(/^\/icon\//);
    expect(PowerTextParser.iconUrl).not.toMatch(/^\/icon\//);
  });

  it("keeps Clipio's own icon on the stable public path", () => {
    // The opposite case, and the reason the rule is a decision rather than a
    // blanket "move everything to assets": WXT discovers manifest icons from
    // public/icon/<size>.png, so 128.png must keep its unhashed URL.
    expect(ClipioParser.iconUrl).toBe("/icon/128.png");
  });
});
