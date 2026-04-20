/**
 * Shadow DOM UI component for the snippet preview feature.
 *
 * Creates a styled popup with snippet list, keyboard navigation, and hover tooltips.
 * Uses Shadow DOM with "open" mode for E2E test compatibility.
 *
 * spec: specs/snippet-preview.spec.md
 */

import type { PreviewPosition, FilteredSnippet } from "./preview-helpers";
import { createPreviewTooltip } from "./preview-helpers";
import interVariableUrl from "~/assets/fonts/InterVariable.woff2?url";

export class SnippetPreviewUI {
  private shadowHost: HTMLElement | null = null;
  private shadowRoot: ShadowRoot | null = null;
  private container: HTMLElement | null = null;
  private list: HTMLElement | null = null;
  private tooltip: HTMLElement | null = null;

  private filteredSnippets: FilteredSnippet[] = [];
  private selectedIndex = 0;
  private visible = false;
  private onSelect?: (snippet: FilteredSnippet) => void;
  private onCancel?: () => void;
  private palette = {
    surface: "#ffffff",
    surfaceMuted: "#fafafa",
    border: "#e5e5e5",
    text: "#111111",
    textMuted: "#666666",
    rowHover: "#f6f6f6",
    rowSelected: "#eeeeee",
    shadow: "0 8px 20px rgba(0, 0, 0, 0.12)",
    tooltipBg: "#111111",
    tooltipText: "#ffffff",
  };

  private getAssetUrl(path: string): string {
    const runtime =
      (
        globalThis as {
          browser?: { runtime?: { getURL?: (p: string) => string } };
        }
      ).browser?.runtime ??
      (
        globalThis as {
          chrome?: { runtime?: { getURL?: (p: string) => string } };
        }
      ).chrome?.runtime;
    return runtime?.getURL ? runtime.getURL(path) : path;
  }

  init(): void {
    if (this.shadowHost) return; // Already initialized

    // Create shadow host element
    this.shadowHost = document.createElement("div");
    this.shadowHost.id = "clipio-snippet-preview-host";
    this.shadowHost.setAttribute("data-clipio-preview", "true");
    this.shadowHost.style.cssText = `
      position: fixed !important;
      z-index: 2147483647 !important;
      pointer-events: auto !important;
      width: 0px !important;
      height: 0px !important;
    `;

    // Create shadow root with "open" mode for E2E test compatibility
    this.shadowRoot = this.shadowHost.attachShadow({ mode: "open" });

    const prefersDark =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches;

    this.palette = prefersDark
      ? {
          surface: "#0b0b0b",
          surfaceMuted: "#111111",
          border: "#242424",
          text: "#f5f5f5",
          textMuted: "#a3a3a3",
          rowHover: "#171717",
          rowSelected: "#1f1f1f",
          shadow: "0 10px 24px rgba(0, 0, 0, 0.45)",
          tooltipBg: "#111111",
          tooltipText: "#f5f5f5",
        }
      : {
          surface: "#ffffff",
          surfaceMuted: "#fafafa",
          border: "#e5e5e5",
          text: "#111111",
          textMuted: "#666666",
          rowHover: "#f6f6f6",
          rowSelected: "#eeeeee",
          shadow: "0 8px 20px rgba(0, 0, 0, 0.12)",
          tooltipBg: "#111111",
          tooltipText: "#ffffff",
        };

    const style = document.createElement("style");
    style.textContent = `
      @font-face {
        font-family: "Inter";
        src: url("${interVariableUrl}") format("woff2");
        font-weight: 100 900;
        font-style: normal;
        font-display: swap;
      }
    `;
    this.shadowRoot.appendChild(style);

    // Create container with styles
    this.container = document.createElement("div");
    this.container.style.cssText = `
      position: absolute;
      background: ${this.palette.surface};
      border: 1px solid ${this.palette.border};
      border-radius: 6px;
      box-shadow: ${this.palette.shadow};
      max-width: 320px;
      min-width: 230px;
      max-height: 220px;
      font-family: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 12px;
      line-height: 1.3;
      overflow: hidden;
      display: none;
      z-index: 2147483647;
    `;

    // Create header with Clipio branding
    const header = document.createElement("div");
    header.className = "clipio-preview-header";
    header.style.cssText = `
      padding: 6px 9px;
      border-bottom: 1px solid ${this.palette.border};
      background: ${this.palette.surfaceMuted};
      font-weight: 600;
      font-size: 11px;
      letter-spacing: 0.02em;
      text-transform: uppercase;
      color: ${this.palette.textMuted};
      display: flex;
      align-items: center;
      gap: 6px;
    `;

    const logo = document.createElement("img");
    logo.src = this.getAssetUrl("/icon/16.png");
    logo.alt = "Clipio";
    logo.style.cssText = `
      width: 16px;
      height: 16px;
      border-radius: 3px;
      flex-shrink: 0;
      display: block;
    `;
    logo.onerror = () => {
      logo.style.display = "none";
    };

    const title = document.createElement("span");
    title.textContent = "Clipio Snippets";

    header.appendChild(logo);
    header.appendChild(title);

    // Create snippet list
    this.list = document.createElement("div");
    this.list.style.cssText = `
      max-height: 180px;
      overflow-y: auto;
      padding: 1px 0;
    `;

    // Create tooltip for hover previews
    this.tooltip = document.createElement("div");
    this.tooltip.style.cssText = `
      position: fixed;
      background: ${this.palette.tooltipBg};
      color: ${this.palette.tooltipText};
      padding: 8px 12px;
      border-radius: 6px;
      font-size: 11px;
      font-family: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      max-width: 300px;
      white-space: pre-wrap;
      word-wrap: break-word;
      z-index: 2147483648;
      display: none;
      pointer-events: none;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
    `;

    // Assemble the UI
    this.container.appendChild(header);
    this.container.appendChild(this.list);
    this.shadowRoot.appendChild(this.container);
    document.body.appendChild(this.tooltip);
    document.body.appendChild(this.shadowHost);
  }

  cleanup(): void {
    if (this.shadowHost) {
      this.shadowHost.remove();
      this.shadowHost = null;
      this.shadowRoot = null;
      this.container = null;
      this.list = null;
    }
    if (this.tooltip) {
      this.tooltip.remove();
      this.tooltip = null;
    }
    this.filteredSnippets = [];
    this.selectedIndex = 0;
    this.visible = false;
    this.onSelect = undefined;
    this.onCancel = undefined;
  }

  setEventHandlers(
    onSelect: (snippet: FilteredSnippet) => void,
    onCancel: () => void
  ): void {
    this.onSelect = onSelect;
    this.onCancel = onCancel;
  }

  show(position: PreviewPosition, snippets: FilteredSnippet[]): void {
    if (!this.container || !this.shadowHost) {
      return;
    }

    this.filteredSnippets = snippets;
    this.selectedIndex = 0;
    this.visible = true;

    // Position the shadowHost itself at the target location
    this.shadowHost.style.left = `${position.x}px`;
    this.shadowHost.style.top = `${position.y}px`;

    // Position container relative to the shadowHost (at 0,0 since shadowHost is positioned)
    this.container.style.left = "0px";
    this.container.style.top = "0px";
    this.container.style.maxHeight = `${position.maxHeight}px`;
    this.container.style.display = "block";

    // Update list content
    this.updateList();

    // Force the shadowHost to match container dimensions after content is populated
    setTimeout(() => {
      if (this.container) {
        const containerRect = this.container.getBoundingClientRect();
        if (containerRect.width > 0 && containerRect.height > 0) {
          this.shadowHost!.style.width = `${containerRect.width}px`;
          this.shadowHost!.style.height = `${containerRect.height}px`;
        }
      }
    }, 0);
  }

  hide(): void {
    if (this.container) {
      this.container.style.display = "none";
    }
    if (this.shadowHost) {
      // Reset shadowHost dimensions when hiding for proper visibility detection
      this.shadowHost.style.width = "0px";
      this.shadowHost.style.height = "0px";
    }
    if (this.tooltip) {
      this.tooltip.style.display = "none";
    }
    this.visible = false;
    this.filteredSnippets = [];
    this.selectedIndex = 0;
  }

  isVisible(): boolean {
    return this.visible;
  }

  handleKeyDown(event: KeyboardEvent): boolean {
    if (!this.visible || this.filteredSnippets.length === 0) return false;

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        this.selectedIndex = Math.min(
          this.selectedIndex + 1,
          this.filteredSnippets.length - 1
        );
        this.updateList();
        return true;

      case "ArrowUp":
        event.preventDefault();
        this.selectedIndex = Math.max(this.selectedIndex - 1, 0);
        this.updateList();
        return true;

      case "Enter":
      case "Tab":
        event.preventDefault();
        if (this.onSelect && this.filteredSnippets[this.selectedIndex]) {
          this.onSelect(this.filteredSnippets[this.selectedIndex]);
        }
        return true;

      case "Escape":
        event.preventDefault();
        if (this.onCancel) {
          this.onCancel();
        }
        return true;

      default:
        return false;
    }
  }

  private updateList(): void {
    if (!this.list) return;

    this.list.innerHTML = "";

    if (this.filteredSnippets.length === 0) {
      const emptyItem = document.createElement("div");
      emptyItem.style.cssText = `
        padding: 12px 16px;
        color: #6b7280;
        text-align: center;
        font-style: italic;
      `;
      emptyItem.textContent = "No snippets found";
      this.list.appendChild(emptyItem);
      return;
    }

    this.filteredSnippets.forEach((snippet, index) => {
      const item = document.createElement("div");
      item.className = "clipio-preview-item";
      const isSelected = index === this.selectedIndex;

      item.style.cssText = `
        padding: 5px 9px;
        cursor: pointer;
        border-bottom: 1px solid ${this.palette.border};
        background: ${isSelected ? this.palette.rowSelected : "transparent"};
        transition: background-color 0.15s ease;
        display: flex;
        align-items: center;
        gap: 6px;
      `;
      item.addEventListener("mouseenter", () => {
        if (!isSelected) item.style.background = this.palette.rowHover;
      });
      item.addEventListener("mouseleave", () => {
        item.style.background = isSelected
          ? this.palette.rowSelected
          : "transparent";
      });
      if (isSelected) {
        item.classList.add("selected");
      }

      // Remove bottom border from last item
      if (index === this.filteredSnippets.length - 1) {
        item.style.borderBottom = "none";
      }

      const contentWrap = document.createElement("div");
      contentWrap.style.cssText = `
        min-width: 0;
        display: grid;
        gap: 1px;
      `;

      const labelDiv = document.createElement("div");
      labelDiv.style.cssText = `
        color: ${this.palette.text};
        font-size: 12px;
        font-weight: 500;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      `;
      labelDiv.textContent = snippet.snippet.label || "Untitled snippet";

      const shortcutDiv = document.createElement("div");
      shortcutDiv.style.cssText = `
        color: ${this.palette.textMuted};
        font-size: 11px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      `;
      shortcutDiv.textContent = snippet.snippet.shortcut;

      contentWrap.appendChild(labelDiv);
      contentWrap.appendChild(shortcutDiv);
      item.appendChild(contentWrap);

      // Add click handler
      item.addEventListener("click", () => {
        if (this.onSelect) {
          this.onSelect(snippet);
        }
      });

      // Add hover handlers for tooltip
      item.addEventListener("mouseenter", (e) => {
        this.showTooltip(e, snippet);
      });

      item.addEventListener("mouseleave", () => {
        this.hideTooltip();
      });

      if (this.list) {
        this.list.appendChild(item);
      }
    });
  }

  private showTooltip(event: MouseEvent, snippet: FilteredSnippet): void {
    if (!this.tooltip) return;

    const content = createPreviewTooltip(snippet.snippet.content);
    if (!content.trim()) return;

    this.tooltip.textContent = content;
    this.tooltip.style.display = "block";

    // Position tooltip to the right of the cursor
    const x = event.clientX + 15;
    const y = event.clientY;

    // Ensure tooltip doesn't go off screen
    const tooltipRect = this.tooltip.getBoundingClientRect();
    const maxX = window.innerWidth - tooltipRect.width - 10;
    const maxY = window.innerHeight - tooltipRect.height - 10;

    this.tooltip.style.left = `${Math.min(x, maxX)}px`;
    this.tooltip.style.top = `${Math.min(y, maxY)}px`;
  }

  private hideTooltip(): void {
    if (this.tooltip) {
      this.tooltip.style.display = "none";
    }
  }
}

// Export singleton instance
export const snippetPreviewUI = new SnippetPreviewUI();
