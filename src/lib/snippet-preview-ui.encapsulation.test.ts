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
    expect(host.getAttribute("data-preview-rows")).toBe("0");
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

    expect(host.getAttribute("data-preview-rows")).toBe("many");
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

  it("marks the palette hidden on hide()", () => {
    const host = document.getElementById("clipio-snippet-preview-host")!;
    showWith(makeFiltered(SECRET_LABEL, SECRET_SHORTCUT, "x", "a"));
    expect(host.getAttribute("data-preview-visible")).toBe("true");
    ui.hide();
    expect(host.getAttribute("data-preview-visible")).toBe("false");
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

  // The row-click guard is defence in depth: the closed root means page script
  // has no handle on a row at all, so this is not reachable from e2e. It is
  // still worth pinning, because it is the guard that would matter if the root
  // were ever reopened.
  describe("row click guard (defence in depth)", () => {
    it("ignores a synthetic click on a row", () => {
      let selectCalls = 0;
      ui.setEventHandlers(
        () => {
          selectCalls += 1;
        },
        () => {}
      );
      showWith(makeFiltered("A", "/a", "a", "1"));
      const item = ui
        .getInternalShadowRoot()!
        .querySelector(".clipio-preview-item")!;
      // A dispatched MouseEvent always has isTrusted === false.
      item.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      expect(selectCalls).toBe(0);
    });

    it("still handles Enter, which is the documented selection path", () => {
      let selected: unknown = null;
      ui.setEventHandlers(
        (s) => {
          selected = s;
        },
        () => {}
      );
      showWith(makeFiltered("A", "/a", "a", "1"));
      const handled = ui.handleKeyDown(
        new KeyboardEvent("keydown", { key: "Enter" })
      );
      expect(handled).toBe(true);
      expect(selected).not.toBeNull();
    });
  });

  // ---- S13: identify the tooltip specifically, not "the first div" ----
  it("keeps the tooltip identifiable inside the root, not just absent from body", () => {
    const root = ui.getInternalShadowRoot()!;
    showWith(makeFiltered(SECRET_LABEL, SECRET_SHORTCUT, "x", "a"));
    // The tooltip is the last child of the root, after the container.
    const tooltip = root.lastElementChild as HTMLElement;
    // It carries the higher z-index of the two, which is what makes it paint
    // above the list. Asserting that is what proves the element we moved is
    // the tooltip and not merely some div.
    expect(tooltip.style.zIndex).toBe("2147483648");
    expect(root.querySelectorAll("div").length).toBeGreaterThan(1);
  });
});
