/**
 * The palette is positioned twice: once from the caret, then again from its
 * measured height. The second pass is what keeps a flipped panel next to the
 * caret instead of at the top of the viewport.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SnippetPreviewUI } from "./snippet-preview-ui";
import type { FilteredSnippet } from "./preview-helpers";

const row = {
  snippet: { id: "1", label: "Address", shortcut: "/addr", content: "text" },
  relevanceScore: 1,
  highlightRanges: [],
} as unknown as FilteredSnippet;

function rect(width: number, height: number): DOMRect {
  return {
    left: 0,
    top: 0,
    width,
    height,
    right: width,
    bottom: height,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect;
}

describe("SnippetPreviewUI placement", () => {
  let ui: SnippetPreviewUI;
  let host: HTMLElement;
  let container: HTMLElement;

  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(window, "innerWidth", {
      value: 1280,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(window, "innerHeight", {
      value: 720,
      writable: true,
      configurable: true,
    });

    ui = new SnippetPreviewUI();
    ui.init();
    const root = ui.getInternalShadowRoot()!;
    container = root.querySelector('[role="listbox"]')!.parentElement!;
    host = root.host as HTMLElement;
  });

  afterEach(() => {
    ui.cleanup();
    host.remove();
    vi.useRealTimers();
  });

  it("flips a measured panel so its bottom edge sits just above the caret", () => {
    vi.spyOn(container, "getBoundingClientRect").mockReturnValue(
      rect(240, 200)
    );

    ui.show({ x: 0, y: 0, maxHeight: 220, anchor: { x: 200, y: 600 } }, [row]);

    // 600 − 200 − 5. The previous math positioned it at y=20 by treating the
    // 575px of free space above the caret as the panel's height.
    expect(host.style.top).toBe("395px");
    expect(host.style.left).toBe("200px");
    expect(container.style.maxHeight).toBe("200px");
  });

  it("keeps a short panel just below the caret near the page bottom", () => {
    vi.spyOn(container, "getBoundingClientRect").mockReturnValue(rect(240, 60));

    ui.show({ x: 0, y: 0, maxHeight: 220, anchor: { x: 200, y: 600 } }, [row]);

    expect(host.style.top).toBe("605px");
    expect(container.style.maxHeight).toBe("60px");
  });

  it("honours a precomputed position when no caret anchor is supplied", () => {
    vi.spyOn(container, "getBoundingClientRect").mockReturnValue(rect(240, 60));

    ui.show({ x: 17, y: 33, maxHeight: 180 }, [row]);

    expect(host.style.left).toBe("17px");
    expect(host.style.top).toBe("33px");
    expect(container.style.maxHeight).toBe("180px");
  });
});
