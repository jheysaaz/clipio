/**
 * Tests for src/lib/copyMarkdownAsRichText.ts
 *
 * Verifies that:
 *   - Plain text and HTML are both written to the clipboard
 *   - {{image:<uuid>}} placeholders are resolved to base64 data URLs
 *   - {{image:<uuid>:<width>}} (width-suffixed) placeholders are also resolved
 *   - stored alt text from MediaMetadata.alt is injected into <img alt="">
 *   - Unresolvable images (null entry) fall back to "[image]" text
 *   - GIF placeholders are passed through as live Giphy CDN URLs (no IDB lookup)
 *   - Plain text strips all formatting marks
 *   - navigator.clipboard.write is called exactly once per invocation
 *   - Throws when navigator.clipboard.write rejects (caller can surface the error)
 */

import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { copyMarkdownAsRichText } from "./copyMarkdownAsRichText";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Mock the media storage module
vi.mock("~/storage/backends/media", () => ({
  getMedia: vi.fn(),
}));

// Import the mock so we can control return values per test
import { getMedia } from "~/storage/backends/media";
const mockGetMedia = getMedia as Mock;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal fake MediaEntry with a Blob that FileReader can read. */
function makeEntry(options: {
  id: string;
  dataContent?: string;
  mimeType?: string;
  alt?: string;
}) {
  const content = options.dataContent ?? "fake-image-bytes";
  const mimeType = options.mimeType ?? "image/png";
  const blob = new Blob([content], { type: mimeType });
  return {
    id: options.id,
    mimeType,
    width: 100,
    height: 100,
    size: blob.size,
    originalSize: blob.size,
    createdAt: new Date().toISOString(),
    alt: options.alt,
    blob,
  };
}

/** Captured clipboard writes. */
let clipboardWriteCalls: ClipboardItem[][] = [];

beforeEach(() => {
  clipboardWriteCalls = [];
  vi.clearAllMocks();

  // Provide a minimal navigator.clipboard.write mock
  Object.defineProperty(globalThis, "navigator", {
    value: {
      clipboard: {
        write: vi.fn(async (items: ClipboardItem[]) => {
          clipboardWriteCalls.push(items);
        }),
      },
    },
    writable: true,
    configurable: true,
  });

  // Provide ClipboardItem constructor if not present in happy-dom
  if (typeof ClipboardItem === "undefined") {
    // @ts-expect-error — polyfill for test environment
    globalThis.ClipboardItem = class ClipboardItem {
      _data: Record<string, Blob>;
      constructor(data: Record<string, Blob>) {
        this._data = data;
      }
      async getType(type: string) {
        return this._data[type];
      }
    };
  }
});

// ---------------------------------------------------------------------------
// Helpers to inspect what was written
// ---------------------------------------------------------------------------

async function getWrittenText(): Promise<string> {
  const item = clipboardWriteCalls[0]?.[0];
  if (!item) return "";
  try {
    const blob = await item.getType("text/plain");
    return blob.text();
  } catch {
    return "";
  }
}

async function getWrittenHtml(): Promise<string> {
  const item = clipboardWriteCalls[0]?.[0];
  if (!item) return "";
  try {
    const blob = await item.getType("text/html");
    return blob.text();
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("copyMarkdownAsRichText", () => {
  // spec: MUST call navigator.clipboard.write exactly once
  it("calls clipboard.write once for plain text content", async () => {
    await copyMarkdownAsRichText("Hello world");
    expect(navigator.clipboard.write).toHaveBeenCalledTimes(1);
  });

  // spec: writes both text/plain and text/html
  it("writes plain text correctly", async () => {
    await copyMarkdownAsRichText("Hello **world**");
    const text = await getWrittenText();
    expect(text).toBe("Hello world");
  });

  it("writes HTML with inline formatting", async () => {
    await copyMarkdownAsRichText("Hello **world**");
    const html = await getWrittenHtml();
    expect(html).toContain("<strong>world</strong>");
  });

  // spec: {{image:<uuid>}} placeholder resolved to base64 data URL
  it("resolves image placeholder to base64 src", async () => {
    const uuid = "550e8400-e29b-41d4-a716-446655440000";
    const entry = makeEntry({ id: uuid });
    mockGetMedia.mockResolvedValueOnce(entry);

    await copyMarkdownAsRichText(`{{image:${uuid}}}`);

    const html = await getWrittenHtml();
    expect(html).toContain('src="data:image/png;base64,');
    expect(html).not.toContain("data-clipio-media");
  });

  // spec: {{image:<uuid>:<width>}} (width-suffixed) also resolved
  it("resolves width-suffixed image placeholder", async () => {
    const uuid = "550e8400-e29b-41d4-a716-446655440000";
    const entry = makeEntry({ id: uuid });
    mockGetMedia.mockResolvedValueOnce(entry);

    await copyMarkdownAsRichText(`{{image:${uuid}:200}}`);

    const html = await getWrittenHtml();
    expect(html).toContain('src="data:image/png;base64,');
    expect(html).toContain("width:200px");
    expect(html).not.toContain("data-clipio-media");
  });

  // spec: stored alt text is injected into <img alt="...">
  it("injects stored alt text into img tag", async () => {
    const uuid = "550e8400-e29b-41d4-a716-446655440000";
    const entry = makeEntry({ id: uuid, alt: "My screenshot" });
    mockGetMedia.mockResolvedValueOnce(entry);

    await copyMarkdownAsRichText(`{{image:${uuid}}}`);

    const html = await getWrittenHtml();
    expect(html).toContain('alt="My screenshot"');
  });

  // spec: alt with double-quotes is escaped in the attribute
  it("escapes double quotes in alt text", async () => {
    const uuid = "550e8400-e29b-41d4-a716-446655440000";
    const entry = makeEntry({ id: uuid, alt: 'Say "hello"' });
    mockGetMedia.mockResolvedValueOnce(entry);

    await copyMarkdownAsRichText(`{{image:${uuid}}}`);

    const html = await getWrittenHtml();
    expect(html).toContain("Say &quot;hello&quot;");
  });

  // spec: when entry.alt is undefined, no alt attribute conflict (uses empty)
  it("omits custom alt when metadata has no alt", async () => {
    const uuid = "550e8400-e29b-41d4-a716-446655440000";
    const entry = makeEntry({ id: uuid, alt: undefined });
    mockGetMedia.mockResolvedValueOnce(entry);

    await copyMarkdownAsRichText(`{{image:${uuid}}}`);

    const html = await getWrittenHtml();
    expect(html).toContain('src="data:image/png;base64,');
    // alt="" is acceptable (stripped from tag since we don't add it when absent)
    expect(html).not.toContain('alt="My');
  });

  // spec: unresolvable image (getMedia returns null) → "[image]" fallback
  it("falls back to [image] text when getMedia returns null", async () => {
    const uuid = "550e8400-e29b-41d4-a716-446655440000";
    mockGetMedia.mockResolvedValueOnce(null);

    await copyMarkdownAsRichText(`{{image:${uuid}}}`);

    const html = await getWrittenHtml();
    expect(html).toContain("[image]");
    expect(html).not.toContain("data:image");
  });

  // spec: plain text for images is always "[image]" regardless of resolution
  it("writes [image] in plain text for image placeholders", async () => {
    const uuid = "550e8400-e29b-41d4-a716-446655440000";
    mockGetMedia.mockResolvedValueOnce(null);

    await copyMarkdownAsRichText(`{{image:${uuid}}}`);

    const text = await getWrittenText();
    expect(text).toBe("[image]");
  });

  // spec: GIF placeholders pass through as CDN URLs, no IDB lookup
  it("converts gif placeholder to live Giphy CDN URL without calling getMedia", async () => {
    await copyMarkdownAsRichText("{{gif:xT9IgG50Lgn6WDJyBW}}");

    expect(mockGetMedia).not.toHaveBeenCalled();
    const html = await getWrittenHtml();
    expect(html).toContain(
      "https://media.giphy.com/media/xT9IgG50Lgn6WDJyBW/giphy.gif"
    );
  });

  // spec: width-suffixed GIF also renders with width style
  it("converts width-suffixed gif placeholder with width style", async () => {
    await copyMarkdownAsRichText("{{gif:xT9IgG50Lgn6WDJyBW:350}}");

    const html = await getWrittenHtml();
    expect(html).toContain("width:350px");
    expect(html).toContain("giphy.gif");
  });

  // spec: GIF plain text is "[GIF]"
  it("writes [GIF] in plain text for gif placeholders", async () => {
    await copyMarkdownAsRichText("{{gif:xT9IgG50Lgn6WDJyBW}}");
    const text = await getWrittenText();
    expect(text).toBe("[GIF]");
  });

  // spec: multiple images in one snippet — all resolved independently
  it("resolves multiple image placeholders in one snippet", async () => {
    const uuid1 = "11111111-1111-1111-1111-111111111111";
    const uuid2 = "22222222-2222-2222-2222-222222222222";
    mockGetMedia
      .mockResolvedValueOnce(makeEntry({ id: uuid1 }))
      .mockResolvedValueOnce(makeEntry({ id: uuid2 }));

    await copyMarkdownAsRichText(
      `First {{image:${uuid1}}} second {{image:${uuid2}}}`
    );

    expect(mockGetMedia).toHaveBeenCalledTimes(2);
    const html = await getWrittenHtml();
    // Both img tags replaced with data URLs
    expect(html).not.toContain("data-clipio-media");
    const dataSrcs = html.match(/src="data:image\/png;base64,/g) ?? [];
    expect(dataSrcs.length).toBe(2);
  });

  // spec: throws (rejects) when clipboard.write fails
  it("throws when clipboard.write rejects", async () => {
    (navigator.clipboard.write as Mock).mockRejectedValueOnce(
      new Error("Permission denied")
    );

    await expect(copyMarkdownAsRichText("Hello")).rejects.toThrow(
      "Permission denied"
    );
  });

  // spec: empty string produces empty plain text and empty HTML
  it("handles empty markdown gracefully", async () => {
    await copyMarkdownAsRichText("");
    const text = await getWrittenText();
    const html = await getWrittenHtml();
    expect(text).toBe("");
    expect(html).toBe("");
  });
});
