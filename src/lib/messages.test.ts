/**
 * Tests for src/lib/messages.ts
 *
 * Five of this file's six tests used to construct a request/response object
 * literal and then assert on its own fields — `expect(resp.alt).toBe("A
 * descriptive alt text")` right after assigning `alt: "A descriptive alt
 * text"`. They could not fail, and they ran on every change to the suite while
 * proving nothing.
 *
 * They have been removed rather than rewritten. The contract they gestured at is
 * a *type* contract, and the real guarantee for a type is `pnpm compile`: if
 * `MediaGetDataUrlResponse` stopped accepting `dataUrl: null`, or started
 * requiring a field, the type-check would fail at the production call sites that
 * construct it. A runtime test cannot check any of that.
 *
 * What remains is the one thing a test can genuinely check here: the wire
 * string. Two further candidates were written and then dropped as redundant —
 * a kebab-case regex assertion (subsumed by the exact match) and a
 * re-import-stability check (an ES module is a singleton, so it could not
 * fail).
 *
 * Sender/receiver desync is not runtime-testable here, and is instead prevented
 * structurally: both the content script and the background import this one
 * constant, so a rename cannot leave one side behind.
 */

import { describe, it, expect } from "vitest";
import { MEDIA_GET_DATA_URL } from "./messages";

describe("messages", () => {
  it("pins the wire string", () => {
    // A protocol constant, not an internal detail: it travels over runtime
    // messaging between the content script and the background. Changing it
    // breaks communication with the other side for as long as an older copy is
    // still installed, and no type-checker or unit test elsewhere would notice.
    expect(MEDIA_GET_DATA_URL).toBe("media-get-data-url");
  });
});
