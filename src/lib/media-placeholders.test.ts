/**
 * Tests for src/lib/media-placeholders.ts
 * spec: specs/media-placeholders.spec.md
 *
 * The invariant these exist to protect: **capture group 1 is always the id, and
 * group 2 is always the width**. Two of the three regex flavours this module
 * replaced got that wrong, and the resulting bugs were a resized image rendering
 * as raw placeholder text in the sidebar, and a media lookup keyed on
 * `<id>:200` which could never match.
 */

import { describe, it, expect } from "vitest";
import {
  IMAGE_PLACEHOLDER_ANCHORED,
  GIF_PLACEHOLDER_ANCHORED,
  imagePlaceholderGlobal,
  gifPlaceholderGlobal,
  anyMediaPlaceholderGlobal,
  formatImagePlaceholder,
  formatGifPlaceholder,
  parseMediaPlaceholder,
  hasMediaPlaceholder,
  hasImagePlaceholder,
  extractMediaRefs,
  extractMediaIds,
  extractImageIds,
  extractGifIds,
  stripMediaPlaceholders,
} from "./media-placeholders";

const UUID = "3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b";

describe("anchored patterns", () => {
  it("matches an unsized image at the start", () => {
    const m = `{{image:${UUID}}}`.match(IMAGE_PLACEHOLDER_ANCHORED);
    expect(m?.[1]).toBe(UUID);
    expect(m?.[2]).toBeUndefined();
  });

  it("captures the width separately, never inside the id", () => {
    // The bug this replaces: a width suffix ending up inside the id.
    const m = `{{image:${UUID}:200}}`.match(IMAGE_PLACEHOLDER_ANCHORED);
    expect(m?.[1]).toBe(UUID);
    expect(m?.[2]).toBe("200");
  });

  it("does not match mid-string, unlike the global form", () => {
    // The distinction is explicit, so a caller picks deliberately.
    expect(`x {{image:${UUID}}}`.match(IMAGE_PLACEHOLDER_ANCHORED)).toBeNull();
    expect(
      `x {{image:${UUID}}}`.match(imagePlaceholderGlobal())
    ).not.toBeNull();
  });

  it("matches a sized GIF", () => {
    const m = `{{gif:abc123XYZ:64}}`.match(GIF_PLACEHOLDER_ANCHORED);
    expect(m?.[1]).toBe("abc123XYZ");
    expect(m?.[2]).toBe("64");
  });

  it("accepts an uppercase-hex image id rather than orphaning it", () => {
    const upper = UUID.toUpperCase();
    expect(`{{image:${upper}}}`.match(IMAGE_PLACEHOLDER_ANCHORED)?.[1]).toBe(
      upper
    );
  });

  it("does not match an id outside the charset", () => {
    // A loose charset would render a broken <img> where literal text is better.
    expect(`{{image:not_a_uuid}}`.match(IMAGE_PLACEHOLDER_ANCHORED)).toBeNull();
  });

  it("does not match an empty id", () => {
    expect("{{image:}}".match(IMAGE_PLACEHOLDER_ANCHORED)).toBeNull();
  });

  it("does not treat a gif id as an image id", () => {
    expect(`{{gif:${UUID}}}`.match(IMAGE_PLACEHOLDER_ANCHORED)).toBeNull();
  });

  it("does not match a non-numeric width", () => {
    expect(
      `{{image:${UUID}:wide}}`.match(IMAGE_PLACEHOLDER_ANCHORED)
    ).toBeNull();
  });
});

describe("global patterns", () => {
  it("finds every reference in a body", () => {
    const body = `a {{image:${UUID}}} b {{gif:xyz}} c {{image:${UUID}:200}}`;
    const found = [...body.matchAll(imagePlaceholderGlobal())].map((m) => m[1]);
    expect(found).toEqual([UUID, UUID]);
  });

  it("does not carry lastIndex between calls", () => {
    // A shared `g` regex would make the second call resume mid-string and
    // silently return fewer results. Results must not depend on call order.
    const body = `{{gif:a}} {{gif:b}} {{gif:c}}`;
    const first = [...body.matchAll(gifPlaceholderGlobal())].length;
    const second = [...body.matchAll(gifPlaceholderGlobal())].length;
    expect(first).toBe(3);
    expect(second).toBe(3);
  });

  it("keeps the id free of the width in a global match", () => {
    const body = `{{image:${UUID}:320}}`;
    const m = [...body.matchAll(imagePlaceholderGlobal())][0];
    expect(m?.[1]).toBe(UUID);
    expect(m?.[2]).toBe("320");
  });

  it("the any-kind pattern reports which kind it matched", () => {
    const body = `{{image:${UUID}}} and {{gif:abc}}`;
    const kinds = [...body.matchAll(anyMediaPlaceholderGlobal())].map(
      (m) => m[1]
    );
    expect(kinds).toEqual(["image", "gif"]);
  });
});

describe("formatting", () => {
  it("round-trips an unsized image", () => {
    const token = formatImagePlaceholder(UUID);
    expect(parseMediaPlaceholder(token)?.id).toBe(UUID);
  });

  it("round-trips a sized image", () => {
    const token = formatImagePlaceholder(UUID, 200);
    expect(token).toBe(`{{image:${UUID}:200}}`);
    const parsed = parseMediaPlaceholder(token);
    expect(parsed?.id).toBe(UUID);
    expect(parsed?.width).toBe(200);
  });

  it("round-trips a sized gif", () => {
    const parsed = parseMediaPlaceholder(formatGifPlaceholder("abc", 64));
    expect(parsed).toEqual({ kind: "gif", id: "abc", width: 64 });
  });

  it("omits a width of zero only when explicitly undefined", () => {
    expect(formatImagePlaceholder(UUID, 0)).toBe(`{{image:${UUID}:0}}`);
  });
});

describe("parseMediaPlaceholder", () => {
  it("reports width as null when absent", () => {
    expect(parseMediaPlaceholder(`{{image:${UUID}}}`)?.width).toBeNull();
  });

  it("reports width as a number, never a string", () => {
    expect(parseMediaPlaceholder(`{{image:${UUID}:200}}`)?.width).toBe(200);
  });

  it("accepts a token already stripped of its braces", () => {
    expect(parseMediaPlaceholder(`image:${UUID}:200`)).toEqual({
      kind: "image",
      id: UUID,
      width: 200,
    });
  });

  it("returns null for a non-reference", () => {
    expect(parseMediaPlaceholder("just some text")).toBeNull();
  });

  it("returns null for an unknown kind", () => {
    expect(parseMediaPlaceholder("{{video:abc}}")).toBeNull();
  });

  it("returns null for an unclosed token", () => {
    expect(parseMediaPlaceholder(`{{image:${UUID}`)).toBeNull();
  });
});

describe("hasMediaPlaceholder", () => {
  it("detects an image reference", () => {
    expect(hasMediaPlaceholder(`x {{image:${UUID}}} y`)).toBe(true);
  });

  it("detects a gif reference", () => {
    expect(hasMediaPlaceholder("x {{gif:abc}} y")).toBe(true);
  });

  it("detects a sized reference", () => {
    expect(hasMediaPlaceholder(`{{image:${UUID}:200}}`)).toBe(true);
  });

  it("is false for a body with none", () => {
    expect(hasMediaPlaceholder("plain text")).toBe(false);
  });

  it("is not confused by a similarly-named placeholder", () => {
    // {{clipboard}} and {{date:…}} are different placeholders entirely.
    expect(hasMediaPlaceholder("{{clipboard}} {{date:now}}")).toBe(false);
  });

  it("hasImagePlaceholder ignores gifs", () => {
    expect(hasImagePlaceholder("{{gif:abc}}")).toBe(false);
    expect(hasImagePlaceholder(`{{image:${UUID}}}`)).toBe(true);
  });
});

describe("extractMediaRefs", () => {
  it("returns kind, id and width for each reference, in order", () => {
    const body = `one {{image:${UUID}:200}} two {{gif:abc}}`;
    expect(extractMediaRefs(body)).toEqual([
      { kind: "image", id: UUID, width: 200 },
      { kind: "gif", id: "abc", width: null },
    ]);
  });

  it("preserves duplicates rather than deciding for the caller", () => {
    // The exporter dedupes and the clipboard path does not; that disagreement is
    // legitimate, so this function must not silently pick a side.
    const body = `{{gif:a}} {{gif:a}}`;
    expect(extractMediaIds(body)).toEqual(["a", "a"]);
  });

  it("extracts only image ids when asked", () => {
    const body = `{{image:${UUID}}} {{gif:abc}} {{image:${UUID}:9}}`;
    expect(extractImageIds(body)).toEqual([UUID, UUID]);
  });

  it("extracts only gif ids when asked", () => {
    expect(
      extractGifIds(`{{image:${UUID}}} {{gif:abc}} {{gif:def:5}}`)
    ).toEqual(["abc", "def"]);
  });

  it("returns an empty list for a body with no references", () => {
    expect(extractMediaRefs("nothing here")).toEqual([]);
  });

  it("handles several references on one line", () => {
    expect(extractImageIds(`{{image:${UUID}}}x{{image:${UUID}}}`)).toEqual([
      UUID,
      UUID,
    ]);
  });
});

describe("stripMediaPlaceholders", () => {
  it("replaces a sized image with the label", () => {
    // The SnippetListItem bug: a sized reference was not matched at all, so the
    // raw placeholder was displayed next to the snippet label.
    expect(stripMediaPlaceholders(`a {{image:${UUID}:200}} b`)).toBe(
      "a [image] b"
    );
  });

  it("replaces a sized gif with the label", () => {
    expect(stripMediaPlaceholders("a {{gif:abc:64}} b")).toBe("a [GIF] b");
  });

  it("uses the default labels", () => {
    expect(stripMediaPlaceholders(`{{image:${UUID}}}`)).toBe("[image]");
    expect(stripMediaPlaceholders("{{gif:abc123}}")).toBe("[GIF]");
  });

  it("accepts custom labels", () => {
    expect(
      stripMediaPlaceholders(`{{image:${UUID}}} {{gif:abc123}}`, {
        image: "(pic)",
        gif: "(gif)",
      })
    ).toBe("(pic) (gif)");
  });

  it("leaves a body with no references untouched", () => {
    expect(stripMediaPlaceholders("plain **text**")).toBe("plain **text**");
  });

  it("does not treat a sized width as meaningful in plain text", () => {
    expect(stripMediaPlaceholders(`{{image:${UUID}:200}}`)).toBe(
      stripMediaPlaceholders(`{{image:${UUID}}}`)
    );
  });
});
