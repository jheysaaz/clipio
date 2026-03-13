/**
 * Tests for src/lib/messages.ts
 * Verifies that message constants and type contracts are exported correctly.
 */

import { describe, it, expect } from "vitest";
import {
  MEDIA_GET_DATA_URL,
  type MediaGetDataUrlRequest,
  type MediaGetDataUrlResponse,
} from "./messages";

describe("messages", () => {
  it("MEDIA_GET_DATA_URL is the expected string constant", () => {
    expect(MEDIA_GET_DATA_URL).toBe("media-get-data-url");
  });

  it("MediaGetDataUrlRequest shape satisfies type check", () => {
    const req: MediaGetDataUrlRequest = {
      type: MEDIA_GET_DATA_URL,
      mediaId: "test-id-123",
    };
    expect(req.type).toBe("media-get-data-url");
    expect(req.mediaId).toBe("test-id-123");
  });

  it("MediaGetDataUrlResponse accepts a data URL string", () => {
    const resp: MediaGetDataUrlResponse = {
      dataUrl: "data:image/png;base64,abc==",
    };
    expect(resp.dataUrl).toContain("data:image/png");
  });

  it("MediaGetDataUrlResponse accepts null dataUrl (blob not found)", () => {
    const resp: MediaGetDataUrlResponse = { dataUrl: null };
    expect(resp.dataUrl).toBeNull();
  });

  it("MediaGetDataUrlResponse carries a non-null alt string", () => {
    const resp: MediaGetDataUrlResponse = {
      dataUrl: "data:image/png;base64,abc==",
      alt: "A descriptive alt text",
    };
    expect(resp.alt).toBe("A descriptive alt text");
  });

  it("MediaGetDataUrlResponse alt is optional and absent by default", () => {
    const resp: MediaGetDataUrlResponse = { dataUrl: null };
    expect(resp.alt).toBeUndefined();
  });
});
