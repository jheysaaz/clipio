import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { SnippetPreviewUI } from "./snippet-preview-ui";

/**
 * The preview panel's scrollbar.
 *
 * The suggestion list is `overflow-y: auto` inside a panel 180px tall that sits over
 * the user's own text. Left unstyled it inherits the OS scrollbar, which on Windows
 * and Linux Chrome is a permanently visible ~15px gutter — a tenth of the panel,
 * present whether or not the list is long enough to scroll.
 *
 * These assert the rules are actually present in the shadow root, because the
 * failure mode is silent: drop the `<style>` element and nothing breaks, the panel
 * just quietly grows a fat scrollbar again. A visual regression with no error is
 * exactly the kind that survives for months.
 */

let ui: SnippetPreviewUI;
let host: HTMLElement;

beforeEach(() => {
  ui = new SnippetPreviewUI();
  ui.init();
  host = ui.getInternalShadowRoot()!.host as HTMLElement;
});

afterEach(() => {
  ui.cleanup();
  host.remove();
});

/** The `<style>` element the UI installs in its shadow root. */
function styleText(): string {
  const style = ui
    .getInternalShadowRoot()!
    .querySelector("style") as HTMLStyleElement | null;
  return style?.textContent ?? "";
}

describe("preview scrollbar", () => {
  it("styles the suggestion list with a thin scrollbar", () => {
    // `scrollbar-width` is the standard property. Firefox honours it; Chrome and
    // Safari need the WebKit pseudo-elements below, so this one alone is not enough.
    expect(styleText()).toContain("scrollbar-width: thin");
  });

  it("narrows the WebKit scrollbar, which is where the fat gutter appears", () => {
    expect(styleText()).toContain(".clipio-preview-list::-webkit-scrollbar");
    expect(styleText()).toMatch(/::-webkit-scrollbar\s*\{[^}]*width:\s*6px/);
  });

  it("does not reserve a permanent gutter", () => {
    // The whole point is that the scrollbar takes width only when the list
    // overflows. `scrollbar-gutter: stable` would reserve it always, which is a
    // worse version of the problem.
    expect(styleText()).not.toContain("scrollbar-gutter: stable");
  });

  it("uses system palette colours rather than literals", () => {
    // So the forced-colors block below covers the scrollbar too. A hard-coded
    // colour would leave the one part of the panel ignoring the user's setting.
    expect(styleText()).toContain("scrollbar-color: ButtonText transparent");
    expect(styleText()).not.toMatch(/scrollbar-color:\s*#[0-9a-fA-F]/);
  });

  it("puts the class on the scrollable list", () => {
    // The rules target a class, and the element carrying it is the one that
    // scrolls. A class on the wrong element styles nothing and fails silently.
    const list = ui
      .getInternalShadowRoot()!
      .querySelector('[role="listbox"]') as HTMLElement;

    expect(list.className).toContain("clipio-preview-list");
    expect(list.style.overflowY).toBe("auto");
  });
});
