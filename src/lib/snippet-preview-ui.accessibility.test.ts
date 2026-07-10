/**
 * @vitest
 * Accessibility tests for snippet preview popup UI.
 * Verifies WCAG 2.1 compliance for listbox/option pattern,
 * screen reader announcements, and keyboard navigation.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SnippetPreviewUI } from "./snippet-preview-ui";
import type { FilteredSnippet } from "./preview-helpers";

function makeSnippet(label: string, shortcut: string, id: string) {
  return {
    snippet: { id, label, shortcut, content: `Content for ${label}` },
    relevanceScore: 100,
    highlightRanges: [],
  };
}

describe("SnippetPreviewUI Accessibility", () => {
  let ui: SnippetPreviewUI;

  beforeEach(() => {
    ui = new SnippetPreviewUI();
    ui.init();
  });

  afterEach(() => {
    ui.cleanup();
  });

  describe("Listbox roles and attributes", () => {
    it("should have role=listbox on the list container", () => {
      // Access shadow root to verify ARIA roles
      const host = document.getElementById("clipio-snippet-preview-host");
      expect(host).not.toBeNull();
      const shadow = host!.shadowRoot;
      expect(shadow).not.toBeNull();

      const list = shadow!.querySelector('[role="listbox"]');
      expect(list).not.toBeNull();
    });

    it("should have aria-label on the listbox", () => {
      const host = document.getElementById("clipio-snippet-preview-host");
      const shadow = host!.shadowRoot;
      const list = shadow!.querySelector('[role="listbox"]');
      expect(list!.getAttribute("aria-label")).toBe("Snippet suggestions");
    });

    it("should set aria-activedescendant on show", () => {
      const snippets: FilteredSnippet[] = [
        makeSnippet("Hello", "/hello", "1"),
        makeSnippet("World", "/world", "2"),
      ];

      ui.show({ x: 0, y: 0, maxHeight: 200 }, snippets);

      const host = document.getElementById("clipio-snippet-preview-host");
      const shadow = host!.shadowRoot;
      const list = shadow!.querySelector('[role="listbox"]');
      expect(list!.getAttribute("aria-activedescendant")).toBe(
        "clipio-preview-option-0"
      );
    });

    it("should update aria-activedescendant on keyboard navigation", () => {
      const snippets: FilteredSnippet[] = [
        makeSnippet("Hello", "/hello", "1"),
        makeSnippet("World", "/world", "2"),
      ];

      ui.show({ x: 0, y: 0, maxHeight: 200 }, snippets);

      // Simulate ArrowDown key
      const event = new KeyboardEvent("keydown", { key: "ArrowDown" });
      ui.handleKeyDown(event);

      const host = document.getElementById("clipio-snippet-preview-host");
      const shadow = host!.shadowRoot;
      const list = shadow!.querySelector('[role="listbox"]');
      expect(list!.getAttribute("aria-activedescendant")).toBe(
        "clipio-preview-option-1"
      );
    });
  });

  describe("Option roles and attributes", () => {
    it("should have role=option and aria-selected on each preview row", () => {
      const snippets: FilteredSnippet[] = [
        makeSnippet("Hello", "/hello", "1"),
        makeSnippet("World", "/world", "2"),
      ];

      ui.show({ x: 0, y: 0, maxHeight: 200 }, snippets);

      const host = document.getElementById("clipio-snippet-preview-host");
      const shadow = host!.shadowRoot;
      const options = shadow!.querySelectorAll('[role="option"]');
      expect(options.length).toBe(2);

      options.forEach((opt) => {
        expect(opt.getAttribute("aria-selected")).toBeTruthy();
      });
    });

    it("should mark first option as selected on show", () => {
      const snippets: FilteredSnippet[] = [
        makeSnippet("Hello", "/hello", "1"),
        makeSnippet("World", "/world", "2"),
      ];

      ui.show({ x: 0, y: 0, maxHeight: 200 }, snippets);

      const host = document.getElementById("clipio-snippet-preview-host");
      const shadow = host!.shadowRoot;
      const firstOption = shadow!.querySelector('[role="option"]');
      expect(firstOption!.getAttribute("aria-selected")).toBe("true");
    });

    it("should have stable IDs on option elements", () => {
      const snippets: FilteredSnippet[] = [
        makeSnippet("Hello", "/hello", "1"),
        makeSnippet("World", "/world", "2"),
      ];

      ui.show({ x: 0, y: 0, maxHeight: 200 }, snippets);

      const host = document.getElementById("clipio-snippet-preview-host");
      const shadow = host!.shadowRoot;
      const options = shadow!.querySelectorAll('[role="option"]');
      expect(options[0].id).toBe("clipio-preview-option-0");
      expect(options[1].id).toBe("clipio-preview-option-1");
    });

    it("should include selected CSS class on selected option", () => {
      const snippets: FilteredSnippet[] = [
        makeSnippet("Hello", "/hello", "1"),
        makeSnippet("World", "/world", "2"),
      ];

      ui.show({ x: 0, y: 0, maxHeight: 200 }, snippets);

      const host = document.getElementById("clipio-snippet-preview-host");
      const shadow = host!.shadowRoot;
      const firstOption = shadow!.querySelector('[role="option"]');
      expect(firstOption!.classList.contains("selected")).toBe(true);
    });

    it("should toggle aria-selected on keyboard navigation", () => {
      const snippets: FilteredSnippet[] = [
        makeSnippet("Hello", "/hello", "1"),
        makeSnippet("World", "/world", "2"),
      ];

      ui.show({ x: 0, y: 0, maxHeight: 200 }, snippets);

      // Arrow down to second option
      const downEvent = new KeyboardEvent("keydown", { key: "ArrowDown" });
      ui.handleKeyDown(downEvent);

      const host = document.getElementById("clipio-snippet-preview-host");
      const shadow = host!.shadowRoot;
      const options = shadow!.querySelectorAll('[role="option"]');
      expect(options[0].getAttribute("aria-selected")).toBe("false");
      expect(options[1].getAttribute("aria-selected")).toBe("true");
    });
  });

  describe("Screen reader live region", () => {
    it("should have aria-live polite region for announcements", () => {
      const snippets: FilteredSnippet[] = [
        makeSnippet("Hello", "/hello", "1"),
        makeSnippet("World", "/world", "2"),
      ];

      ui.show({ x: 0, y: 0, maxHeight: 200 }, snippets);

      const host = document.getElementById("clipio-snippet-preview-host");
      const shadow = host!.shadowRoot;
      const liveRegion = shadow!.querySelector('[aria-live="polite"]');
      expect(liveRegion).not.toBeNull();
      expect(liveRegion!.getAttribute("aria-atomic")).toBe("true");
    });

    it("should announce selected item on keyboard navigation", () => {
      const snippets: FilteredSnippet[] = [
        makeSnippet("Hello", "/hello", "1"),
        makeSnippet("World", "/world", "2"),
      ];

      ui.show({ x: 0, y: 0, maxHeight: 200 }, snippets);

      // Arrow down to select "World"
      const downEvent = new KeyboardEvent("keydown", { key: "ArrowDown" });
      ui.handleKeyDown(downEvent);

      const host = document.getElementById("clipio-snippet-preview-host");
      const shadow = host!.shadowRoot;
      const liveRegion = shadow!.querySelector('[aria-live="polite"]');
      expect(liveRegion!.textContent).toContain("World");
      expect(liveRegion!.textContent).toContain("2 of 2");
    });
  });

  describe("Keyboard behavior", () => {
    it("should close on Escape", () => {
      const snippets: FilteredSnippet[] = [makeSnippet("Hello", "/hello", "1")];

      ui.show({ x: 0, y: 0, maxHeight: 200 }, snippets);

      const cancelFn = () => {};
      ui.setEventHandlers(() => {}, cancelFn);

      const escEvent = new KeyboardEvent("keydown", { key: "Escape" });
      const handled = ui.handleKeyDown(escEvent);

      expect(handled).toBe(true);
    });

    it("should select on Enter", () => {
      const snippets: FilteredSnippet[] = [makeSnippet("Hello", "/hello", "1")];

      ui.show({ x: 0, y: 0, maxHeight: 200 }, snippets);

      let selected: unknown = null;
      ui.setEventHandlers(
        (s) => {
          selected = s;
        },
        () => {}
      );

      const enterEvent = new KeyboardEvent("keydown", { key: "Enter" });
      const handled = ui.handleKeyDown(enterEvent);

      expect(handled).toBe(true);
      expect(selected).not.toBeNull();
    });

    it("should select on Tab", () => {
      const snippets: FilteredSnippet[] = [makeSnippet("Hello", "/hello", "1")];

      ui.show({ x: 0, y: 0, maxHeight: 200 }, snippets);

      let selected: unknown = null;
      ui.setEventHandlers(
        (s) => {
          selected = s;
        },
        () => {}
      );

      const tabEvent = new KeyboardEvent("keydown", { key: "Tab" });
      const handled = ui.handleKeyDown(tabEvent);

      expect(handled).toBe(true);
      expect(selected).not.toBeNull();
    });
  });

  describe("High contrast support", () => {
    it("should have high-contrast CSS for selected items", () => {
      ui.init();

      const host = document.getElementById("clipio-snippet-preview-host");
      const shadow = host!.shadowRoot;
      const style = shadow!.querySelector("style");
      expect(style!.textContent).toContain("prefers-contrast: high");
      expect(style!.textContent).toContain(".clipio-preview-item.selected");
    });
  });

  describe("Header accessibility", () => {
    it("should hide header from accessibility tree", () => {
      const host = document.getElementById("clipio-snippet-preview-host");
      const shadow = host!.shadowRoot;
      const header = shadow!.querySelector(".clipio-preview-header");
      expect(header!.getAttribute("aria-hidden")).toBe("true");
    });
  });
});
