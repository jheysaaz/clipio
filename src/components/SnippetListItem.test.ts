/**
 * Tests for src/components/SnippetListItem.tsx
 * spec: specs/media-placeholders.spec.md
 *
 * Only the content-preview pipeline is covered here. The component itself is
 * presentation (excluded from unit coverage and reached through the popup e2e),
 * but `getContentPreview` is the function that produces the text a user reads
 * in the snippet list, and it contained a real bug.
 */

import { describe, it, expect } from "vitest";
import { getContentPreview } from "./SnippetListItem";

const UUID = "3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b";

describe("getContentPreview — media placeholders", () => {
  it("shows a label for an unsized image reference", () => {
    expect(getContentPreview(`see {{image:${UUID}}}`)).toBe("see [image]");
  });

  it("shows a label for a RESIZED image reference", () => {
    // The bug this pins. The hand-typed regex here was
    // `{{image:[a-f0-9-]+}}` with no width support, so a snippet whose image the
    // user had dragged to 200px displayed the raw placeholder text in the
    // snippet list: `{{image:3f2a…:200}}`.
    expect(getContentPreview(`see {{image:${UUID}:200}}`)).toBe("see [image]");
  });

  it("shows a label for a resized gif reference", () => {
    expect(getContentPreview("see {{gif:abc123:64}}")).toBe("see [GIF]");
  });

  it("leaves no raw placeholder text behind for a sized reference", () => {
    const preview = getContentPreview(`{{image:${UUID}:200}}`);
    expect(preview).not.toContain("{{image:");
    expect(preview).not.toContain(":200");
  });

  it("handles a sized reference followed by other text", () => {
    expect(getContentPreview(`a {{image:${UUID}:320}} b`)).toBe("a [image] b");
  });
});

describe("getContentPreview — other placeholders and markdown", () => {
  it("keeps the non-media placeholder labels", () => {
    expect(getContentPreview("{{clipboard}}")).toBe("{{clipboard}}");
    expect(getContentPreview("{{cursor}}")).toBe("{{cursor}}");
  });

  it("strips markdown emphasis", () => {
    expect(getContentPreview("**bold** text")).toBe("bold text");
  });

  it("collapses newlines to spaces", () => {
    expect(getContentPreview("one\ntwo\r\nthree")).toBe("one two three");
  });

  it("truncates a long preview", () => {
    const preview = getContentPreview("x".repeat(400));
    expect(preview.length).toBeLessThan(400);
    expect(preview.endsWith("…")).toBe(true);
  });
});
