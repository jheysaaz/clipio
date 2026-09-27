/**
 * Tests for src/lib/content-format-migration.ts
 * spec: specs/content-format-migration.spec.md
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import {
  migrateContentFormat,
  isRawHtmlPlaceholder,
  RAW_HTML_PREFIX,
} from "./content-format-migration";

/**
 * The converter is mocked so a test can make it throw. `vi.spyOn` cannot do
 * this: content-format-migration calls htmlToMarkdownPortable from inside its
 * own module, so the call never goes through the namespace object a spy
 * replaces, and the replacement would silently never fire.
 */
const hoisted = vi.hoisted(() => ({ throwOnConvert: false }));
vi.mock("./html-to-markdown", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./html-to-markdown")>();
  return {
    ...actual,
    htmlToMarkdownPortable: (html: string) => {
      if (hoisted.throwOnConvert) {
        throw new Error("converter unavailable");
      }
      return actual.htmlToMarkdownPortable(html);
    },
  };
});

afterEach(() => {
  hoisted.throwOnConvert = false;
});

const legacy = (overrides: Record<string, unknown> = {}) => ({
  id: "s1",
  label: "L",
  shortcut: "/l",
  content: "plain body",
  contentFormat: "markdown",
  tags: [],
  usageCount: 0,
  createdAt: "2024-01-01T00:00:00.000Z",
  updatedAt: "2024-01-01T00:00:00.000Z",
  ...overrides,
});

describe("migrateContentFormat — no-op path", () => {
  it("strips contentFormat from a markdown snippet", () => {
    const out = migrateContentFormat(legacy());
    expect(Object.keys(out)).not.toContain("contentFormat");
  });

  it("leaves a markdown body untouched", () => {
    expect(migrateContentFormat(legacy()).content).toBe("plain body");
  });

  it("preserves every other field", () => {
    const out = migrateContentFormat(legacy({ tags: ["x"], usageCount: 7 }));
    expect(out.tags).toEqual(["x"]);
    expect(out.usageCount).toBe(7);
    expect(out.id).toBe("s1");
  });

  it("handles a snippet with no contentFormat at all", () => {
    const noFlag = legacy();
    delete (noFlag as Record<string, unknown>).contentFormat;
    expect(migrateContentFormat(noFlag).content).toBe("plain body");
  });

  it("does not mutate the input", () => {
    const input = legacy();
    migrateContentFormat(input);
    expect(input.contentFormat).toBe("markdown");
  });

  it("preserves an unrecognised format value rather than guessing", () => {
    // A value this version does not know about must not be silently rewritten
    // as markdown, or a future format would be destroyed on read.
    const out = migrateContentFormat(
      legacy({ contentFormat: "some-future-format" })
    );
    expect(out.content).toBe("plain body");
    expect(Object.keys(out)).not.toContain("contentFormat");
  });
});

describe("migrateContentFormat — HTML conversion", () => {
  it("converts inline marks", () => {
    const out = migrateContentFormat(
      legacy({ content: "<strong>Bold</strong>", contentFormat: "html" })
    );
    expect(out.content).toContain("**Bold**");
    expect(Object.keys(out)).not.toContain("contentFormat");
  });

  it("converts italic", () => {
    const out = migrateContentFormat(
      legacy({ content: "<em>It</em>", contentFormat: "html" })
    );
    expect(out.content).toContain("_It_");
  });

  it("converts a paragraph", () => {
    const out = migrateContentFormat(
      legacy({ content: "<p>para</p>", contentFormat: "html" })
    );
    expect(out.content).toContain("para");
  });

  it("converts a heading to its text", () => {
    // The same loss profile the TextBlaze / Power Text imports have always
    // had. Documented in the spec rather than papered over.
    const out = migrateContentFormat(
      legacy({ content: "<h2>Title</h2>", contentFormat: "html" })
    );
    expect(out.content).toContain("Title");
    expect(out.content).not.toContain("<h2>");
  });

  it("converts a link to markdown", () => {
    const out = migrateContentFormat(
      legacy({
        content: '<a href="https://x.test">link</a>',
        contentFormat: "html",
      })
    );
    expect(out.content).toContain("https://x.test");
    expect(out.content).toContain("link");
  });

  it("converts plain text identically", () => {
    const out = migrateContentFormat(
      legacy({ content: "no tags here", contentFormat: "html" })
    );
    expect(out.content).toBe("no tags here");
  });

  it("is idempotent: a second pass is a no-op", () => {
    const once = migrateContentFormat(
      legacy({ content: "<strong>Bold</strong>", contentFormat: "html" })
    );
    const twice = migrateContentFormat({
      ...once,
      contentFormat: "html",
    } as never);
    expect(twice.content).toBe(once.content);
  });

  it("leaves an empty html body empty", () => {
    const out = migrateContentFormat(
      legacy({ content: "", contentFormat: "html" })
    );
    expect(out.content).toBe("");
  });

  it("leaves a whitespace-only html body alone", () => {
    const out = migrateContentFormat(
      legacy({ content: "   ", contentFormat: "html" })
    );
    expect(out.content).toBe("   ");
  });
});

describe("migrateContentFormat — the no-total-loss guard", () => {
  // Losing a user's entire snippet body to a failed conversion is the one
  // outcome not acceptable here.
  it("keeps a table's cell text rather than dropping it", () => {
    // The guard is only for a body that converts to nothing. A table is lossy
    // but not empty, so it must convert normally — and its cell text must
    // survive, which is what distinguishes a conversion from a deletion.
    const out = migrateContentFormat(
      legacy({
        content: "<table><tr><td>a</td><td>b</td></tr></table>",
        contentFormat: "html",
      })
    );
    expect(isRawHtmlPlaceholder(out.content)).toBe(false);
    expect(out.content).toContain("a");
    expect(out.content).toContain("b");
  });

  it("wraps a preserved body in the raw-html placeholder", () => {
    // A script-only body converts to nothing, which is the shape the guard
    // exists for: the body was non-empty and the result is not.
    const out = migrateContentFormat(
      legacy({ content: "<script>alert(1)</script>", contentFormat: "html" })
    );
    expect(isRawHtmlPlaceholder(out.content)).toBe(true);
    expect(out.content.startsWith(RAW_HTML_PREFIX)).toBe(true);
    expect(out.content).toContain("alert(1)");
  });

  it("returns the body untouched when the converter throws", () => {
    // A converter that cannot run has lost nothing, so the body must come back
    // verbatim — and must NOT be wrapped in the placeholder, which would
    // manufacture visible junk in a snippet the user never wrote. This is a
    // distinct outcome from the guard above, where the conversion ran and
    // produced nothing.
    // spec: specs/content-format-migration.spec.md
    hoisted.throwOnConvert = true;
    const body = "<strong>Bold</strong> body";
    const out = migrateContentFormat(
      legacy({ content: body, contentFormat: "html" })
    );
    expect(out.content).toBe(body);
    expect(isRawHtmlPlaceholder(out.content)).toBe(false);
  });

  it("still drops the flag when the converter throws", () => {
    // The flag is retired either way: leaving it set would make the next read
    // retry a conversion that already failed.
    hoisted.throwOnConvert = true;
    const out = migrateContentFormat(
      legacy({ content: "body", contentFormat: "html" })
    );
    expect(out).not.toHaveProperty("contentFormat");
  });

  it("does not fire the guard for an empty source", () => {
    const out = migrateContentFormat(
      legacy({ content: "", contentFormat: "html" })
    );
    expect(isRawHtmlPlaceholder(out.content)).toBe(false);
  });
});

describe("isRawHtmlPlaceholder", () => {
  it("recognises a placeholder", () => {
    expect(isRawHtmlPlaceholder(RAW_HTML_PREFIX + "x}}")).toBe(true);
  });

  it("rejects ordinary markdown", () => {
    expect(isRawHtmlPlaceholder("**bold**")).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(isRawHtmlPlaceholder("")).toBe(false);
  });

  it("rejects a prefix with no closing braces", () => {
    expect(isRawHtmlPlaceholder(RAW_HTML_PREFIX + "x")).toBe(false);
  });
});
