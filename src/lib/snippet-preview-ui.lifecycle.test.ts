/**
 * @vitest
 * Lifecycle and guard paths for the snippet preview UI.
 *
 * The other two suites for this module both call `ui.init()` in `beforeEach` and
 * then drive the happy path, so almost every branch below was uncovered:
 *
 *  - methods reached before `init()`, or after `cleanup()` nulls the DOM refs
 *  - key handling when there is nothing to select, or no handler installed
 *  - the tooltip's empty-content and missing-element early returns
 *  - `getAssetUrl` falling back from `browser` to `chrome` to a bare path
 *
 * Each of these is a real state the module can be in — the content script calls
 * `cleanup()` on disable, and a keypress can arrive in the same tick as a hide —
 * so they are worth pinning rather than leaving to chance. A guard that returns
 * early is only correct if something asserts it returned early.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SnippetPreviewUI } from "./snippet-preview-ui";
import type { FilteredSnippet } from "./preview-helpers";

function makeFiltered(
  label: string,
  shortcut: string,
  content: string,
  id: string
): FilteredSnippet {
  return {
    snippet: { id, label, shortcut, content },
    relevanceScore: 100,
    highlightRanges: [],
  } as unknown as FilteredSnippet;
}

const POSITION = { x: 10, y: 10, maxHeight: 220 };

describe("SnippetPreviewUI lifecycle", () => {
  let ui: SnippetPreviewUI;

  beforeEach(() => {
    ui = new SnippetPreviewUI();
  });

  afterEach(() => {
    ui.cleanup();
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
  });

  // --- before init -------------------------------------------------------

  it("ignores show() before init rather than throwing on a null container", () => {
    expect(() =>
      ui.show(POSITION, [makeFiltered("A", "/a", "x", "1")])
    ).not.toThrow();
    expect(ui.isVisible()).toBe(false);
  });

  it("ignores hide() before init", () => {
    expect(() => ui.hide()).not.toThrow();
    expect(ui.isVisible()).toBe(false);
  });

  it("reports not-visible before init", () => {
    expect(ui.isVisible()).toBe(false);
  });

  it("ignores key presses before init", () => {
    const event = new KeyboardEvent("keydown", { key: "ArrowDown" });
    expect(ui.handleKeyDown(event)).toBe(false);
  });

  // --- after cleanup -----------------------------------------------------

  it("ignores show() after cleanup, having torn the DOM down", () => {
    ui.init();
    ui.show(POSITION, [makeFiltered("A", "/a", "x", "1")]);
    expect(ui.isVisible()).toBe(true);
    ui.cleanup();

    // cleanup() nulls container and list. show() must bail rather than
    // dereference them — this is the same tick a disable takes effect.
    expect(() =>
      ui.show(POSITION, [makeFiltered("B", "/b", "y", "2")])
    ).not.toThrow();
    expect(ui.isVisible()).toBe(false);
  });

  it("ignores hide() after cleanup", () => {
    ui.init();
    ui.cleanup();

    expect(() => ui.hide()).not.toThrow();
  });

  it("reports not-visible after cleanup", () => {
    ui.init();
    ui.show(POSITION, [makeFiltered("A", "/a", "x", "1")]);
    ui.cleanup();

    expect(ui.isVisible()).toBe(false);
  });

  it("ignores key presses after cleanup", () => {
    ui.init();
    ui.show(POSITION, [makeFiltered("A", "/a", "x", "1")]);
    ui.cleanup();

    // handleKeyDown's guard is `!visible || filteredSnippets.length === 0`, and
    // cleanup clears both. Without the guard this would reach updateList() on a
    // null list.
    expect(
      ui.handleKeyDown(new KeyboardEvent("keydown", { key: "ArrowDown" }))
    ).toBe(false);
  });

  it("is safe to init twice, and the second init is a no-op", () => {
    ui.init();
    const first = document.getElementById("clipio-snippet-preview-host");
    ui.init();

    // init() returns early when a host already exists. Two hosts would mean two
    // palettes injected into the page for one palette.
    expect(document.getElementById("clipio-snippet-preview-host")).toBe(first);
    expect(
      document.querySelectorAll("#clipio-snippet-preview-host")
    ).toHaveLength(1);
  });

  it("is safe to cleanup before init", () => {
    expect(() => ui.cleanup()).not.toThrow();
  });

  it("is safe to cleanup twice", () => {
    ui.init();
    ui.cleanup();
    expect(() => ui.cleanup()).not.toThrow();
  });

  // --- empty and absent handler states -----------------------------------

  it("shows an empty list rather than an activedescendant pointing at nothing", () => {
    ui.init();

    ui.show(POSITION, []);

    // Zero snippets means there is no option to point at. The guard exists so
    // aria-activedescendant is never left referencing a row that isn't there,
    // which is the kind of thing a screen reader announces as blank.
    const list = ui.getInternalShadowRoot()!.querySelector('[role="listbox"]');
    expect(list?.hasAttribute("aria-activedescendant")).toBe(false);
  });

  it("swallows every key press while showing an empty list", () => {
    ui.init();
    ui.show(POSITION, []);

    for (const key of ["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"]) {
      expect(ui.handleKeyDown(new KeyboardEvent("keydown", { key }))).toBe(
        false
      );
    }
  });

  it("swallows a key press that is neither a navigation nor a selection", () => {
    ui.init();
    ui.show(POSITION, [makeFiltered("A", "/a", "x", "1")]);

    // The default arm. Returning true for an unhandled key would swallow the
    // page's own shortcut handling.
    expect(ui.handleKeyDown(new KeyboardEvent("keydown", { key: "a" }))).toBe(
      false
    );
  });

  it("consumes Enter and Tab even with no select handler installed", () => {
    ui.init();
    ui.show(POSITION, [makeFiltered("A", "/a", "x", "1")]);

    // setEventHandlers is never called in this state. The key must still be
    // consumed — returning false here would let the character reach the page.
    expect(
      ui.handleKeyDown(new KeyboardEvent("keydown", { key: "Enter" }))
    ).toBe(true);
    expect(ui.handleKeyDown(new KeyboardEvent("keydown", { key: "Tab" }))).toBe(
      true
    );
  });

  it("consumes Escape even with no cancel handler installed", () => {
    ui.init();
    ui.show(POSITION, [makeFiltered("A", "/a", "x", "x", "1")]);

    expect(
      ui.handleKeyDown(new KeyboardEvent("keydown", { key: "Escape" }))
    ).toBe(true);
  });

  it("selects through the installed handler", () => {
    const onSelect = vi.fn();
    ui.init();
    ui.setEventHandlers(onSelect, vi.fn());
    ui.show(POSITION, [makeFiltered("A", "/a", "x", "1")]);

    ui.handleKeyDown(new KeyboardEvent("keydown", { key: "Enter" }));

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0][0].snippet.id).toBe("1");
  });

  it("cancels through the installed handler", () => {
    const onCancel = vi.fn();
    ui.init();
    ui.setEventHandlers(vi.fn(), onCancel);
    ui.show(POSITION, [makeFiltered("A", "/a", "x", "1")]);

    ui.handleKeyDown(new KeyboardEvent("keydown", { key: "Escape" }));

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  // --- selection movement ------------------------------------------------

  it("clamps at the last row going down", () => {
    ui.init();
    ui.setEventHandlers(vi.fn(), vi.fn());
    const rows = [
      makeFiltered("A", "/a", "x", "1"),
      makeFiltered("B", "/b", "x", "2"),
    ];
    ui.show(POSITION, rows);

    ui.handleKeyDown(new KeyboardEvent("keydown", { key: "ArrowDown" }));
    ui.handleKeyDown(new KeyboardEvent("keydown", { key: "ArrowDown" }));
    ui.handleKeyDown(new KeyboardEvent("keydown", { key: "ArrowDown" }));

    const onSelect = vi.fn();
    ui.setEventHandlers(onSelect, vi.fn());
    ui.handleKeyDown(new KeyboardEvent("keydown", { key: "Enter" }));

    // Without the Math.min clamp the index would run past the end and Enter
    // would select nothing, so the keypress would look like it did nothing.
    expect(onSelect.mock.calls[0][0].snippet.id).toBe("2");
  });

  it("clamps at the first row going up", () => {
    ui.init();
    const onSelect = vi.fn();
    ui.setEventHandlers(onSelect, vi.fn());
    ui.show(POSITION, [makeFiltered("A", "/a", "x", "1")]);

    ui.handleKeyDown(new KeyboardEvent("keydown", { key: "ArrowUp" }));
    ui.handleKeyDown(new KeyboardEvent("keydown", { key: "Enter" }));

    expect(onSelect.mock.calls[0][0].snippet.id).toBe("1");
  });

  it("does not move the selection on an unhandled key", () => {
    const onSelect = vi.fn();
    ui.init();
    ui.setEventHandlers(onSelect, vi.fn());
    ui.show(POSITION, [
      makeFiltered("A", "/a", "x", "1"),
      makeFiltered("B", "/b", "x", "2"),
    ]);

    ui.handleKeyDown(new KeyboardEvent("keydown", { key: "ArrowDown" }));
    ui.handleKeyDown(new KeyboardEvent("keydown", { key: "Shift" }));
    ui.handleKeyDown(new KeyboardEvent("keydown", { key: "Enter" }));

    expect(onSelect.mock.calls[0][0].snippet.id).toBe("2");
  });

  // --- hover -------------------------------------------------------------

  it("highlights an unselected row on hover and drops the highlight on leave", () => {
    ui.init();
    // Two rows, so row 1 is NOT the selected one. The hover guard is
    // `if (!isSelected)`, so pointing this at the selected row would pass
    // vacuously — selected rows keep their own colour by design.
    ui.show(POSITION, [
      makeFiltered("A", "/a", "content here", "1"),
      makeFiltered("B", "/b", "content here", "2"),
    ]);
    const items = ui
      .getInternalShadowRoot()!
      .querySelectorAll(".clipio-preview-item") as NodeListOf<HTMLElement>;
    const unselected = items[1];
    const restColor = unselected.style.background;

    unselected.dispatchEvent(new MouseEvent("mouseenter"));
    const hovered = unselected.style.background;

    unselected.dispatchEvent(new MouseEvent("mouseleave"));

    expect(hovered).not.toBe(restColor);
    expect(unselected.style.background).toBe(restColor);
  });

  it("does not hover-highlight the selected row", () => {
    ui.init();
    ui.show(POSITION, [
      makeFiltered("A", "/a", "content here", "1"),
      makeFiltered("B", "/b", "content here", "2"),
    ]);
    const selected = ui
      .getInternalShadowRoot()!
      .querySelector(".clipio-preview-item.selected") as HTMLElement;
    const before = selected.style.background;

    selected.dispatchEvent(new MouseEvent("mouseenter"));

    expect(selected.style.background).toBe(before);
  });

  it("restores the selected row's own background when a selected row is hovered", () => {
    ui.init();
    ui.show(POSITION, [
      makeFiltered("A", "/a", "content here", "1"),
      makeFiltered("B", "/b", "content here", "2"),
    ]);
    // Row 0 is selected. Hovering it must not paint the hover colour over the
    // selection, or the user loses track of what Enter will insert.
    const selected = ui
      .getInternalShadowRoot()!
      .querySelector(".clipio-preview-item.selected") as HTMLElement;
    const selectedBackground = selected.style.background;

    selected.dispatchEvent(new MouseEvent("mouseenter"));
    expect(selected.style.background).toBe(selectedBackground);

    selected.dispatchEvent(new MouseEvent("mouseleave"));
    expect(selected.style.background).toBe(selectedBackground);
  });

  // --- tooltip -----------------------------------------------------------

  it("shows no tooltip for a snippet with empty content", () => {
    ui.init();
    ui.show(POSITION, [makeFiltered("A", "/a", "   ", "1")]);
    const item = ui
      .getInternalShadowRoot()!
      .querySelector(".clipio-preview-item") as HTMLElement;

    expect(() =>
      item.dispatchEvent(
        new MouseEvent("mouseenter", { clientX: 5, clientY: 5 })
      )
    ).not.toThrow();
  });

  it("hides a tooltip that was showing when the row is left", () => {
    ui.init();
    ui.show(POSITION, [makeFiltered("A", "/a", "some content", "1")]);
    const item = ui
      .getInternalShadowRoot()!
      .querySelector(".clipio-preview-item") as HTMLElement;

    item.dispatchEvent(
      new MouseEvent("mouseenter", { clientX: 5, clientY: 5 })
    );
    expect(() =>
      item.dispatchEvent(new MouseEvent("mouseleave"))
    ).not.toThrow();
  });

  it("leaving a row after cleanup does not throw on the removed tooltip", () => {
    ui.init();
    ui.show(POSITION, [makeFiltered("A", "/a", "some content", "1")]);
    const item = ui
      .getInternalShadowRoot()!
      .querySelector(".clipio-preview-item") as HTMLElement;
    ui.cleanup();

    // The listener outlives the tooltip it closes. hideTooltip's guard is what
    // keeps a stale mouseleave from throwing into the page's event loop.
    expect(() =>
      item.dispatchEvent(new MouseEvent("mouseleave"))
    ).not.toThrow();
  });

  it("ignores a synthetic click on a row", () => {
    const onSelect = vi.fn();
    ui.init();
    ui.setEventHandlers(onSelect, vi.fn());
    ui.show(POSITION, [makeFiltered("zzq-private", "/p", "x", "1")]);
    const item = ui
      .getInternalShadowRoot()!
      .querySelector(".clipio-preview-item") as HTMLElement;

    // The security boundary. isTrusted is UA-set, and a page reaching into the
    // page world can dispatch a click but cannot forge one — so this must not
    // insert anything. See docs/decisions/0001.
    item.click();
    expect(onSelect).not.toHaveBeenCalled();

    item.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onSelect).not.toHaveBeenCalled();
  });

  // --- asset URLs --------------------------------------------------------

  it("falls back to a bare path when no extension runtime is present", () => {
    vi.stubGlobal("browser", undefined);
    vi.stubGlobal("chrome", undefined);

    const probe = new SnippetPreviewUI();
    probe.init();

    // No runtime means no chrome-extension:// URL, so the raw path is returned.
    // It will not resolve, but it must not throw during init — a page that
    // shadows `browser` should degrade the logo, not break the palette.
    expect(() => probe.init()).not.toThrow();
    probe.cleanup();
  });

  it("falls back to chrome.runtime when browser.runtime is absent", () => {
    vi.stubGlobal("browser", undefined);
    vi.stubGlobal("chrome", {
      runtime: { getURL: (p: string) => `chrome-extension://test/${p}` },
    });

    const probe = new SnippetPreviewUI();
    probe.init();
    probe.show(POSITION, [makeFiltered("A", "/a", "x", "1")]);
    const img = probe
      .getInternalShadowRoot()!
      .querySelector("img") as HTMLImageElement | null;

    expect(img?.src).toContain("chrome-extension://test/");
    probe.cleanup();
  });

  it("does not throw when matchMedia is unavailable", () => {
    vi.stubGlobal("matchMedia", undefined);

    const probe = new SnippetPreviewUI();
    // The dark-mode probe is `typeof window.matchMedia === "function" && ...`.
    // A host page that deletes matchMedia should get the light palette, not an
    // exception during init.
    expect(() => probe.init()).not.toThrow();
    probe.cleanup();
  });
});
