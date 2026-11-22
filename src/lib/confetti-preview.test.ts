/**
 * The preview's contract is one visible burst — not a stream of them, and not
 * a no-op that leaves the settings button looking broken.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ confetti: vi.fn() }));

vi.mock("canvas-confetti", () => ({ default: mocks.confetti }));

import { previewConfetti } from "./confetti-preview";

beforeEach(() => {
  mocks.confetti.mockReset().mockResolvedValue(null);
});

describe("previewConfetti", () => {
  it("fires exactly one burst from below the middle of the viewport", () => {
    previewConfetti();

    expect(mocks.confetti).toHaveBeenCalledTimes(1);
    expect(mocks.confetti).toHaveBeenCalledWith(
      expect.objectContaining({
        particleCount: 90,
        origin: { y: 0.65 },
      })
    );
  });
});
