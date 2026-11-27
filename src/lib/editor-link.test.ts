import { describe, expect, it } from "vitest";

import { normalizeEditorLinkUrl } from "./editor-link";

describe("normalizeEditorLinkUrl", () => {
  it("keeps allowed schemes intact", () => {
    expect(normalizeEditorLinkUrl("https://example.com/a")).toBe(
      "https://example.com/a"
    );
    expect(normalizeEditorLinkUrl("http://example.com")).toBe(
      "http://example.com"
    );
    expect(normalizeEditorLinkUrl("mailto:hi@example.com")).toBe(
      "mailto:hi@example.com"
    );
    expect(normalizeEditorLinkUrl("tel:+15551234")).toBe("tel:+15551234");
  });

  it("treats a bare domain as https", () => {
    expect(normalizeEditorLinkUrl("  example.com/path  ")).toBe(
      "https://example.com/path"
    );
  });

  it("does not hand an unknown scheme back as a link target", () => {
    // Negative case: a javascript: URL must not survive as an href.
    expect(normalizeEditorLinkUrl("javascript:alert(1)")).toBe(
      "https://javascript:alert(1)"
    );
  });

  it("returns null when there is no URL to insert", () => {
    expect(normalizeEditorLinkUrl("   ")).toBeNull();
  });
});
