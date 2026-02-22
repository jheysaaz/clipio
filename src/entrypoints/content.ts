import { STORAGE_KEYS, TIMING } from "~/config/constants";
import { incrementSnippetUsage } from "~/utils/usageTracking";
import confetti from "canvas-confetti";

export default defineContentScript({
  matches: ["<all_urls>"],
  runAt: "document_idle",

  main() {
    interface Snippet {
      id: string;
      shortcut: string;
      content: string;
      label: string;
    }

    // 🎉 Confetti effect when snippet is inserted
    function showConfetti(x: number, y: number) {
      // Convert screen coordinates to canvas coordinates (0-1 range)
      const originX = x / window.innerWidth;
      const originY = y / window.innerHeight;

      confetti({
        particleCount: 50,
        spread: 60,
        origin: { x: originX, y: originY },
        colors: [
          "#6366f1",
          "#8b5cf6",
          "#ec4899",
          "#f59e0b",
          "#10b981",
          "#3b82f6",
        ],
        ticks: 150,
        gravity: 1.2,
        scalar: 0.8,
        drift: 0,
      });
    }

    // Get cursor position on screen for confetti
    function getCursorScreenPosition(element: HTMLElement): {
      x: number;
      y: number;
    } {
      // For contenteditable elements, use selection API
      if (element.isContentEditable) {
        const selection = window.getSelection();
        if (selection && selection.rangeCount > 0) {
          const range = selection.getRangeAt(0);
          const rect = range.getBoundingClientRect();
          if (rect.width > 0 || rect.height > 0) {
            return { x: rect.left, y: rect.top };
          }
        }
      }

      // For input/textarea, create a mirror div to measure cursor position
      if (element.tagName === "INPUT" || element.tagName === "TEXTAREA") {
        const input = element as HTMLInputElement | HTMLTextAreaElement;
        const cursorPos = input.selectionStart || 0;

        // Create a hidden mirror element
        const mirror = document.createElement("div");
        const computed = window.getComputedStyle(input);

        // Copy styles
        mirror.style.cssText = `
          position: absolute;
          visibility: hidden;
          white-space: pre-wrap;
          word-wrap: break-word;
          font-family: ${computed.fontFamily};
          font-size: ${computed.fontSize};
          font-weight: ${computed.fontWeight};
          letter-spacing: ${computed.letterSpacing};
          line-height: ${computed.lineHeight};
          padding: ${computed.padding};
          border: ${computed.border};
          box-sizing: ${computed.boxSizing};
          width: ${input.tagName === "TEXTAREA" ? computed.width : "auto"};
        `;

        // Text before cursor + marker span
        const textBeforeCursor = input.value.substring(0, cursorPos);
        mirror.textContent = textBeforeCursor;
        const marker = document.createElement("span");
        marker.textContent = "|";
        mirror.appendChild(marker);

        document.body.appendChild(mirror);

        // Get input position and marker offset
        const inputRect = input.getBoundingClientRect();
        const markerRect = marker.getBoundingClientRect();

        document.body.removeChild(mirror);

        // Calculate actual cursor position
        const x =
          inputRect.left +
          markerRect.left -
          mirror.getBoundingClientRect().left +
          input.scrollLeft;
        const y = inputRect.top + inputRect.height / 2;

        return { x: Math.min(x, inputRect.right - 10), y };
      }

      // Fallback to element center
      const rect = element.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }

    let snippets: Snippet[] = [];
    let typingTimer: ReturnType<typeof setTimeout> | null = null;
    const TYPING_TIMEOUT = TIMING.TYPING_TIMEOUT;
    let isExtensionValid = true;

    // Check if extension context is still valid
    function checkExtensionContext(): boolean {
      try {
        if (!browser.runtime?.id) {
          isExtensionValid = false;
          return false;
        }
        return true;
      } catch {
        isExtensionValid = false;
        return false;
      }
    }

    // Load snippets from the content-script cache in browser.storage.local
    async function loadSnippets() {
      if (!checkExtensionContext()) {
        return;
      }

      try {
        const cachedData = await browser.storage.local.get(
          STORAGE_KEYS.CACHED_SNIPPETS
        );
        if (cachedData[STORAGE_KEYS.CACHED_SNIPPETS]) {
          const parsedData = JSON.parse(
            cachedData[STORAGE_KEYS.CACHED_SNIPPETS] as string
          );
          snippets = Array.isArray(parsedData)
            ? parsedData
            : parsedData.items || [];
        }
      } catch (error) {
        if (
          error instanceof Error &&
          error.message.includes("Extension context invalidated")
        ) {
          isExtensionValid = false;
        }
      }
    }

    // Find snippet by checking the text before cursor
    function findSnippetMatch(
      text: string,
      cursorPosition: number
    ): { snippet: Snippet; startPos: number; endPos: number } | null {
      if (!text || snippets.length === 0) return null;

      const textBeforeCursor = text.substring(0, cursorPosition);

      for (const snippet of snippets) {
        const shortcut = snippet.shortcut;
        if (textBeforeCursor.endsWith(shortcut)) {
          const startPos = cursorPosition - shortcut.length;
          if (startPos === 0 || /[\s\n]/.test(text[startPos - 1])) {
            return { snippet, startPos, endPos: cursorPosition };
          }
        }
      }

      return null;
    }

    // Convert markdown to plain text (content is now stored as markdown)
    function markdownToPlainText(content: string): string {
      let text = content;
      // Extract link URLs only (strip label): [label](url) → url
      text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$2");
      // Remove markdown formatting
      text = text.replace(/\*\*([^*]+)\*\*/g, "$1"); // bold
      text = text.replace(/_([^_]+)_/g, "$1"); // italic
      text = text.replace(/~~([^~]+)~~/g, "$1"); // strikethrough
      text = text.replace(/`([^`]+)`/g, "$1"); // code
      text = text.replace(/<u>([^<]+)<\/u>/g, "$1"); // underline
      // Handle any legacy HTML (for backward compatibility)
      if (text.includes("<")) {
        const temp = document.createElement("div");
        temp.innerHTML = text;
        text = temp.textContent || temp.innerText || "";
      }
      return text;
    }

    // Sanitize a URL to prevent XSS (only allow http, https, mailto)
    function sanitizeUrl(url: string): string {
      const trimmed = url.trim();
      if (/^(https?:\/\/|mailto:)/i.test(trimmed)) {
        return trimmed;
      }
      // Block javascript: and other dangerous schemes
      if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
        return "";
      }
      // Bare domain or path — assume https
      return `https://${trimmed}`;
    }

    // Escape HTML special characters
    function escapeHtml(text: string): string {
      return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
    }

    // Convert markdown inline formatting to HTML
    // Processes: links (before italic to avoid URL underscore conflicts),
    // bold, italic, strikethrough, code, underline
    function markdownInlineToHtml(text: string): string {
      let result = "";
      let remaining = text;

      while (remaining.length > 0) {
        // Link [label](url) — must be before italic
        const linkMatch = remaining.match(/^\[([^\]]+)\]\(([^)]+)\)/);
        if (linkMatch) {
          const label = markdownInlineToHtml(linkMatch[1]); // recurse for nested marks
          const url = sanitizeUrl(linkMatch[2]);
          if (url) {
            result += `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
          } else {
            result += escapeHtml(linkMatch[1]);
          }
          remaining = remaining.slice(linkMatch[0].length);
          continue;
        }

        // Bold **text**
        const boldMatch = remaining.match(/^\*\*([^*]+)\*\*/);
        if (boldMatch) {
          result += `<strong>${markdownInlineToHtml(boldMatch[1])}</strong>`;
          remaining = remaining.slice(boldMatch[0].length);
          continue;
        }

        // Italic _text_
        const italicMatch = remaining.match(/^_([^_]+)_/);
        if (italicMatch) {
          result += `<em>${markdownInlineToHtml(italicMatch[1])}</em>`;
          remaining = remaining.slice(italicMatch[0].length);
          continue;
        }

        // Strikethrough ~~text~~
        const strikeMatch = remaining.match(/^~~([^~]+)~~/);
        if (strikeMatch) {
          result += `<s>${markdownInlineToHtml(strikeMatch[1])}</s>`;
          remaining = remaining.slice(strikeMatch[0].length);
          continue;
        }

        // Code `text`
        const codeMatch = remaining.match(/^`([^`]+)`/);
        if (codeMatch) {
          result += `<code>${escapeHtml(codeMatch[1])}</code>`;
          remaining = remaining.slice(codeMatch[0].length);
          continue;
        }

        // Underline <u>text</u>
        const underlineMatch = remaining.match(/^<u>([^<]+)<\/u>/);
        if (underlineMatch) {
          result += `<u>${markdownInlineToHtml(underlineMatch[1])}</u>`;
          remaining = remaining.slice(underlineMatch[0].length);
          continue;
        }

        // Find next special character
        const nextSpecial = remaining.search(
          /\[(?=[^\]]+\]\([^)]+\))|\*\*|_(?!_)|~~|`|<u>/
        );
        if (nextSpecial === -1) {
          result += escapeHtml(remaining);
          break;
        } else if (nextSpecial === 0) {
          // No match at position 0 — consume one char to avoid infinite loop
          result += escapeHtml(remaining[0]);
          remaining = remaining.slice(1);
        } else {
          result += escapeHtml(remaining.slice(0, nextSpecial));
          remaining = remaining.slice(nextSpecial);
        }
      }

      return result;
    }

    // Convert full markdown content to HTML
    function markdownToHtml(content: string): string {
      const paragraphs = content.split(/\n/);
      const htmlParts = paragraphs.map((para) => markdownInlineToHtml(para));
      return htmlParts.join("<br>");
    }

    // Format date according to the specified format
    function formatDate(format: string, dateStr?: string): string {
      const date = dateStr ? new Date(dateStr + "T00:00:00") : new Date();
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, "0");
      const day = String(date.getDate()).padStart(2, "0");

      switch (format) {
        case "iso":
          return `${year}-${month}-${day}`;
        case "us":
          return `${month}/${day}/${year}`;
        case "eu":
          return `${day}/${month}/${year}`;
        case "long":
          return date.toLocaleDateString("en-US", {
            year: "numeric",
            month: "long",
            day: "numeric",
          });
        case "short":
          return date.toLocaleDateString("en-US", {
            year: "2-digit",
            month: "short",
            day: "numeric",
          });
        default:
          return `${year}-${month}-${day}`;
      }
    }

    // Process snippet content with dynamic placeholders
    // Returns { content: string, cursorOffset: number | null }
    interface ProcessedContent {
      content: string;
      cursorOffset: number | null;
    }

    async function processSnippetContent(
      content: string,
      asHtml: boolean = false
    ): Promise<ProcessedContent> {
      // Process dynamic placeholders on the raw markdown FIRST
      // (before any format conversion, so replaced text doesn't contain accidental markdown)
      let processedContent = content;
      let cursorOffset: number | null = null;

      // Process clipboard placeholder
      if (processedContent.includes("{{clipboard}}")) {
        try {
          const clipboardText = await navigator.clipboard.readText();
          processedContent = processedContent.replace(
            /\{\{clipboard\}\}/g,
            clipboardText
          );
        } catch (error) {
          console.error("[Clipio] Failed to read clipboard:", error);
        }
      }

      // Process date placeholders - {{date:format}}
      const dateRegex = /\{\{date:([a-z]+)\}\}/g;
      let dateMatch;
      while ((dateMatch = dateRegex.exec(processedContent)) !== null) {
        const format = dateMatch[1];
        const formattedDate = formatDate(format);
        processedContent = processedContent.replace(
          dateMatch[0],
          formattedDate
        );
        dateRegex.lastIndex = 0;
      }

      // Process datepicker placeholders - {{datepicker:YYYY-MM-DD}}
      const datepickerRegex = /\{\{datepicker:(\d{4}-\d{2}-\d{2})\}\}/g;
      let datepickerMatch;
      while (
        (datepickerMatch = datepickerRegex.exec(processedContent)) !== null
      ) {
        const dateStr = datepickerMatch[1];
        const formattedDate = formatDate("long", dateStr);
        processedContent = processedContent.replace(
          datepickerMatch[0],
          formattedDate
        );
        datepickerRegex.lastIndex = 0;
      }

      if (asHtml) {
        // For HTML mode: insert a marker element for cursor positioning
        processedContent = processedContent.replace(
          /\{\{cursor\}\}/,
          '<span id="clipio-cursor-marker" data-clipio-cursor="true"></span>'
        );
        // Remove any remaining cursor placeholders
        processedContent = processedContent.replace(/\{\{cursor\}\}/g, "");
        // Convert markdown → HTML
        processedContent = markdownToHtml(processedContent);
      } else {
        // For plain text mode: strip markdown and handle cursor offset
        const cursorMatch = processedContent.match(/\{\{cursor\}\}/);
        if (cursorMatch && cursorMatch.index !== undefined) {
          processedContent = processedContent.replace(/\{\{cursor\}\}/, "");
          // Convert to plain text, then compute cursor offset
          processedContent = markdownToPlainText(processedContent);
          // Re-calculate the cursor offset on the plain text
          // We need to process the content before the cursor marker separately
          const beforeCursor = content.substring(0, cursorMatch.index);
          // Replace placeholders in beforeCursor (same as above but for the portion before cursor)
          let processedBefore = beforeCursor;
          processedBefore = processedBefore.replace(/\{\{clipboard\}\}/g, ""); // already replaced above
          processedBefore = processedBefore.replace(/\{\{date:[a-z]+\}\}/g, "");
          processedBefore = processedBefore.replace(
            /\{\{datepicker:\d{4}-\d{2}-\d{2}\}\}/g,
            ""
          );
          cursorOffset = markdownToPlainText(processedBefore).length;
        } else {
          processedContent = markdownToPlainText(processedContent);
        }
      }

      return { content: processedContent, cursorOffset };
    }

    // Replace shortcut with snippet content in input / textarea
    async function expandSnippet(
      element: HTMLInputElement | HTMLTextAreaElement
    ) {
      if (!isExtensionValid) return;

      const cursorPosition = element.selectionStart || element.value.length;
      const match = findSnippetMatch(element.value, cursorPosition);
      if (!match) return;

      const { snippet, startPos, endPos } = match;
      const { content: processedContent, cursorOffset } =
        await processSnippetContent(snippet.content, false);

      const textBefore = element.value.substring(0, startPos);
      const textAfter = element.value.substring(endPos);
      element.value = textBefore + processedContent + textAfter;

      // If cursor placeholder was found, position cursor there; otherwise at the end
      const newCursorPos =
        cursorOffset !== null
          ? startPos + cursorOffset
          : startPos + processedContent.length;
      element.setSelectionRange(newCursorPos, newCursorPos);

      element.dispatchEvent(
        new Event("input", { bubbles: true, cancelable: true })
      );
      element.dispatchEvent(
        new Event("change", { bubbles: true, cancelable: true })
      );
      element.focus();

      // 🎉 Show confetti!
      const pos = getCursorScreenPosition(element);
      showConfetti(pos.x, pos.y);

      incrementSnippetUsage(snippet.id).catch((err) => {
        console.error("Failed to increment snippet usage:", err);
      });
    }

    // Handle input events with debounce
    function handleInput(event: Event) {
      if (!isExtensionValid) return;
      const target = event.target as HTMLInputElement | HTMLTextAreaElement;
      if (!target || !target.value) return;
      if (typingTimer) clearTimeout(typingTimer);
      typingTimer = setTimeout(() => expandSnippet(target), TYPING_TIMEOUT);
    }

    // Expand snippet in contenteditable elements with HTML support
    async function expandSnippetInContentEditable(
      element: HTMLElement,
      textNode: Node,
      range: Range,
      match: { snippet: Snippet; startPos: number; endPos: number }
    ) {
      const { snippet, startPos, endPos } = match;
      const text = textNode.textContent || "";
      const { content: processedContent } =
        await processSnippetContent(snippet.content, true);

      const tempDiv = document.createElement("div");
      tempDiv.innerHTML = processedContent;

      const textBefore = text.substring(0, startPos);
      const textAfter = text.substring(endPos);

      const fragment = document.createDocumentFragment();
      if (textBefore) fragment.appendChild(document.createTextNode(textBefore));
      while (tempDiv.firstChild) fragment.appendChild(tempDiv.firstChild);
      if (textAfter) fragment.appendChild(document.createTextNode(textAfter));

      const parent = textNode.parentNode;
      if (parent) parent.replaceChild(fragment, textNode);

      // Handle cursor positioning via marker element
      const cursorMarker = element.querySelector(
        '[data-clipio-cursor="true"]'
      );
      if (cursorMarker) {
        const sel = window.getSelection();
        if (sel) {
          const cursorRange = document.createRange();
          cursorRange.setStartAfter(cursorMarker);
          cursorRange.collapse(true);
          sel.removeAllRanges();
          sel.addRange(cursorRange);
        }
        cursorMarker.remove();
      }

      element.dispatchEvent(
        new Event("input", { bubbles: true, cancelable: true })
      );

      // 🎉 Show confetti!
      const pos = getCursorScreenPosition(element);
      showConfetti(pos.x, pos.y);

      incrementSnippetUsage(snippet.id).catch(console.error);
    }

    // Handle keydown to expand immediately on Space or Tab
    function handleKeyDown(event: KeyboardEvent) {
      if (!isExtensionValid) return;
      const target = event.target as HTMLElement;
      const isInputOrTextarea =
        target.tagName === "INPUT" || target.tagName === "TEXTAREA";
      const isContentEditable = target.isContentEditable;

      if (!isInputOrTextarea && !isContentEditable) return;
      if (event.key !== " " && event.key !== "Tab") return;

      if (typingTimer) clearTimeout(typingTimer);

      if (isInputOrTextarea) {
        const inputTarget = target as HTMLInputElement | HTMLTextAreaElement;
        const cursorPosition =
          inputTarget.selectionStart || inputTarget.value.length;
        const match = findSnippetMatch(inputTarget.value, cursorPosition);
        if (match) {
          event.preventDefault();
          expandSnippet(inputTarget);
        }
      } else if (isContentEditable) {
        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0) return;
        const range = selection.getRangeAt(0);
        const textNode = range.startContainer;
        if (textNode.nodeType === Node.TEXT_NODE) {
          const text = textNode.textContent || "";
          const match = findSnippetMatch(text, range.startOffset);
          if (match) {
            event.preventDefault();
            expandSnippetInContentEditable(target, textNode, range, match);
          }
        }
      }
    }

    // Handle input events for contenteditable
    function handleContentEditableInput(event: Event) {
      if (!isExtensionValid) return;
      const target = event.target as HTMLElement;
      if (!target.isContentEditable) return;
      if (typingTimer) clearTimeout(typingTimer);
      typingTimer = setTimeout(async () => {
        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0) return;
        const range = selection.getRangeAt(0);
        const textNode = range.startContainer;
        if (textNode.nodeType === Node.TEXT_NODE) {
          const text = textNode.textContent || "";
          const match = findSnippetMatch(text, range.startOffset);
          if (match) {
            await expandSnippetInContentEditable(
              target,
              textNode,
              range,
              match
            );
          }
        }
      }, TYPING_TIMEOUT);
    }

    async function initialize() {
      await loadSnippets();

      document.addEventListener(
        "input",
        (event) => {
          const target = event.target as HTMLElement;
          if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") {
            handleInput(event);
          } else if (target.isContentEditable) {
            handleContentEditableInput(event);
          }
        },
        true
      );

      document.addEventListener(
        "keydown",
        (event) => {
          const target = event.target as HTMLElement;
          if (
            target.tagName === "INPUT" ||
            target.tagName === "TEXTAREA" ||
            target.isContentEditable
          ) {
            handleKeyDown(event);
          }
        },
        true
      );

      // Reload snippets when storage changes
      browser.storage.onChanged.addListener(
        (
          changes: Record<string, Browser.storage.StorageChange>,
          areaName: string
        ) => {
          if (!checkExtensionContext()) return;
          if (areaName === "local" && changes[STORAGE_KEYS.CACHED_SNIPPETS]) {
            try {
              const newValue = changes[STORAGE_KEYS.CACHED_SNIPPETS].newValue;
              if (newValue) {
                const parsedData =
                  typeof newValue === "string"
                    ? JSON.parse(newValue)
                    : newValue;
                snippets = Array.isArray(parsedData)
                  ? parsedData
                  : parsedData.items || [];
              }
            } catch (error) {
              console.error("[Clipio] Error parsing updated snippets:", error);
              loadSnippets();
            }
          }
        }
      );
    }

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", initialize);
    } else {
      initialize();
    }
  },
});
