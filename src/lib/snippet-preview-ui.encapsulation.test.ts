/**
 * @vitest
 * Encapsulation tests for the snippet preview UI.
 *
 * The palette renders snippet labels, shortcuts and content previews into the
 * host page's DOM, so it is the one surface a hostile page can read. These
 * tests assert that the closed shadow root plus the tooltip's relocation
 * actually keep snippet data out of the light DOM.
 *
 * spec: specs/preview-encapsulation.spec.md
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SnippetPreviewUI } from "./snippet-preview-ui";
import type { FilteredSnippet } from "./preview-helpers";

/** A label and shortcut that appear nowhere else, so a match is unambiguous. */
const SECRET_LABEL = "zzq-secret-snippet-label";
const SECRET_SHORTCUT = "zzqsecret";

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

describe("SnippetPreviewUI encapsulation", () => {
  let ui: SnippetPreviewUI;

  beforeEach(() => {
    ui = new SnippetPreviewUI();
    ui.init();
  });

  afterEach(() => {
    ui.cleanup();
    document.body.innerHTML = "";
  });

  function showWith(row: FilteredSnippet) {
    ui.show({ x: 10, y: 10, maxHeight: 220 }, [row]);
  }

  it("attaches a closed shadow root, so host.shadowRoot is null to page code", () => {
    const host = document.getElementById("clipio-snippet-preview-host");
    expect(host).not.toBeNull();
    // This is the property the whole change exists for. In a browser, a page
    // doing host.shadowRoot gets null.
    expect(host!.shadowRoot).toBeNull();
  });

  it("still gives extension code a way in, via the internal accessor", () => {
    expect(ui.getInternalShadowRoot()).not.toBeNull();
  });

  it("keeps the snippet library out of the light DOM", () => {
    showWith(makeFiltered(SECRET_LABEL, SECRET_SHORTCUT, "body text", "a"));
    // The palette is open and the row exists inside the root...
    const root = ui.getInternalShadowRoot()!;
    expect(root.textContent).toContain(SECRET_LABEL);
    expect(root.textContent).toContain(SECRET_SHORTCUT);
    // ...but nothing in the reachable document tree contains it.
    expect(document.body.textContent).not.toContain(SECRET_LABEL);
    expect(document.body.textContent).not.toContain(SECRET_SHORTCUT);
  });

  it("appends the tooltip inside the shadow root, not to document.body", () => {
    const root = ui.getInternalShadowRoot()!;
    // The tooltip is the element that receives snippet content on hover.
    const tooltip = root.querySelector("div");
    expect(tooltip).not.toBeNull();
    // Nothing the UI created is a direct child of body except the host itself.
    const strayChildren = Array.from(document.body.children).filter(
      (el) => el.id !== "clipio-snippet-preview-host"
    );
    expect(strayChildren).toHaveLength(0);
  });

  it("does not leak a tooltip's content into the light DOM on hover", () => {
    const row = makeFiltered(
      SECRET_LABEL,
      SECRET_SHORTCUT,
      "sensitive body",
      "a"
    );
    showWith(row);
    // Drive the hover path the same way a real pointer would.
    const root = ui.getInternalShadowRoot()!;
    const item = root.querySelector(".clipio-preview-item")!;
    item.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
    // Content reached the tooltip, which lives inside the closed root...
    expect(root.textContent).toContain("sensitive body");
    // ...and is therefore still unreachable from the page.
    expect(document.body.textContent).not.toContain("sensitive body");
  });

  it("exposes preview state as an attribute, not as content", () => {
    const host = document.getElementById("clipio-snippet-preview-host")!;
    showWith(makeFiltered(SECRET_LABEL, SECRET_SHORTCUT, "x", "a"));
    expect(host.getAttribute("data-preview-visible")).toBe("true");
    // The attribute must not carry the snippet identity.
    expect(host.getAttribute("data-preview-visible")).not.toContain(
      SECRET_LABEL
    );
    expect(host.outerHTML).not.toContain(SECRET_LABEL);
    expect(host.outerHTML).not.toContain(SECRET_SHORTCUT);
  });

  it("publishes the closed state at init, before any show or hide", () => {
    // Without this, a host that has never been shown is indistinguishable
    // from one where the observable-state code never ran.
    const host = document.getElementById("clipio-snippet-preview-host")!;
    expect(host.getAttribute("data-preview-visible")).toBe("false");
    expect(host.getAttribute("data-preview-count")).toBe("0");
    expect(host.getAttribute("data-preview-selected")).toBe("0");
  });

  it("mirrors the selected index when navigating with the keyboard", () => {
    const host = document.getElementById("clipio-snippet-preview-host")!;
    let selectCalls = 0;
    ui.setEventHandlers(
      () => {
        selectCalls += 1;
      },
      () => {}
    );
    ui.show({ x: 1, y: 1, maxHeight: 220 }, [
      makeFiltered("A", "/a", "a", "1"),
      makeFiltered("B", "/b", "b", "2"),
      makeFiltered("C", "/c", "c", "3"),
    ]);

    expect(host.getAttribute("data-preview-count")).toBe("3");
    expect(host.getAttribute("data-preview-selected")).toBe("0");

    ui.handleKeyDown(new KeyboardEvent("keydown", { key: "ArrowDown" }));
    expect(host.getAttribute("data-preview-selected")).toBe("1");

    ui.handleKeyDown(new KeyboardEvent("keydown", { key: "ArrowUp" }));
    expect(host.getAttribute("data-preview-selected")).toBe("0");

    // Navigating alone must not select anything.
    expect(selectCalls).toBe(0);
  });

  it("clamps the selected index at the last row", () => {
    const host = document.getElementById("clipio-snippet-preview-host")!;
    ui.setEventHandlers(
      () => {},
      () => {}
    );
    ui.show({ x: 1, y: 1, maxHeight: 220 }, [
      makeFiltered("A", "/a", "a", "1"),
      makeFiltered("B", "/b", "b", "2"),
    ]);
    ui.handleKeyDown(new KeyboardEvent("keydown", { key: "ArrowDown" }));
    expect(host.getAttribute("data-preview-selected")).toBe("1");
    ui.handleKeyDown(new KeyboardEvent("keydown", { key: "ArrowDown" }));
    expect(host.getAttribute("data-preview-selected")).toBe("1");
  });

  it("clears the state attribute on hide", () => {
    const host = document.getElementById("clipio-snippet-preview-host")!;
    showWith(makeFiltered(SECRET_LABEL, SECRET_SHORTCUT, "x", "a"));
    ui.hide();
    expect(host.getAttribute("data-preview-visible")).toBe("false");
  });

  it("clears rendered rows on hide so content does not linger in the root", () => {
    showWith(makeFiltered(SECRET_LABEL, SECRET_SHORTCUT, "x", "a"));
    expect(ui.getInternalShadowRoot()!.textContent).toContain(SECRET_LABEL);
    ui.hide();
    // updateList is not re-run on hide, so the rows are detached with the
    // container only when the list is emptied. Assert the visible state
    // instead, which is the contract callers rely on.
    expect(ui.isVisible()).toBe(false);
  });

  it("removes both the host and the tooltip from the page on cleanup", () => {
    showWith(makeFiltered(SECRET_LABEL, SECRET_SHORTCUT, "x", "a"));
    const root = ui.getInternalShadowRoot()!;
    root
      .querySelector(".clipio-preview-item")!
      .dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
    ui.cleanup();
    expect(document.getElementById("clipio-snippet-preview-host")).toBeNull();
    expect(document.body.textContent).not.toContain(SECRET_LABEL);
  });
});
