import { TIMING, SENTRY_TEST_MESSAGE_TYPE } from "~/config/constants";
import { cachedSnippetsItem, confettiEnabledItem } from "~/storage/items";
import { incrementSnippetUsage } from "~/utils/usageTracking";
import confetti from "canvas-confetti";
import { initSentry, captureError, captureMessage } from "~/lib/sentry";
import { makeRelayTransport } from "~/lib/sentry-relay";
import {
  buildShortcutIndex,
  findSnippetMatch as findSnippetMatchHelper,
  formatDate,
  processSnippetContent as processSnippetContentHelper,
  type ContentSnippet,
  type ShortcutIndex,
} from "~/lib/content-helpers";

export default defineContentScript({
  matches: ["<all_urls>"],
  runAt: "document_idle",

  main() {
    // ── Sentry (content script) ───────────────────────────────────────
    // Relay transport forwards envelopes via background when host CSP blocks fetch.
    initSentry("content", { transport: makeRelayTransport });

    // Dev only: test Sentry capture (message from options or keyboard shortcut)
    if ((import.meta.env.MODE as string) !== "production") {
      browser.runtime.onMessage.addListener((message: unknown): boolean => {
        if (
          typeof message === "object" &&
          message !== null &&
          (message as { type?: string }).type === SENTRY_TEST_MESSAGE_TYPE
        ) {
          console.info(
            "[Clipio] Sentry test triggered (content script, from options): sending exception + message"
          );
          captureError(
            new Error("Clipio Sentry test exception (content script)")
          );
          captureMessage("Clipio Sentry test message (content script)", "info");
          return false;
        }
        return false;
      });
      document.addEventListener(
        "keydown",
        (e) => {
          if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "E") {
            e.preventDefault();
            console.info(
              "[Clipio] Sentry test triggered (content script): sending exception + message"
            );
            captureError(
              new Error(
                "Clipio Sentry test exception (content script, shortcut)"
              )
            );
            captureMessage(
              "Clipio Sentry test message (content script, shortcut)",
              "info"
            );
          }
        },
        true
      );
    }

    // Use the shared ContentSnippet interface from content-helpers
    type Snippet = ContentSnippet;

    // ── Confetti (UX) ─────────────────────────────────────────────────
    // Dedicated confetti canvas that sits above all page content
    let confettiCanvas: HTMLCanvasElement | null = null;
    let confettiInstance: confetti.CreateTypes | null = null;

    function getConfettiInstance(): confetti.CreateTypes {
      if (confettiInstance && confettiCanvas?.isConnected) {
        return confettiInstance;
      }
      // (Re-)create a fixed full-viewport canvas above everything
      if (confettiCanvas?.isConnected) confettiCanvas.remove();
      confettiCanvas = document.createElement("canvas");
      confettiCanvas.style.cssText =
        "position:fixed;inset:0;width:100vw;height:100vh;z-index:314159;pointer-events:none;";
      document.documentElement.appendChild(confettiCanvas);
      confettiInstance = confetti.create(confettiCanvas, { resize: true });
      return confettiInstance;
    }

    // 🎉 Confetti effect when snippet is inserted
    function showConfetti(x: number, y: number) {
      // Convert screen coordinates to canvas coordinates (0-1 range)
      const originX = x / window.innerWidth;
      const originY = y / window.innerHeight;

      getConfettiInstance()({
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
        ticks: 100,
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
    let confettiEnabled = true; // default on; overridden from storage in initialize()
    let justExpanded = false; // guard to skip redundant input events after expansion

    // ── Shortcut lookup index ──────────────────────────────────────────
    let shortcutIndex: ShortcutIndex = { map: new Map(), lengths: [] };

    function rebuildShortcutIndex() {
      shortcutIndex = buildShortcutIndex(snippets);
    }

    // Check if extension context is still valid
    function checkExtensionContext(): boolean {
      try {
        if (!browser.runtime?.id) {
          isExtensionValid = false;
          captureMessage("Extension context no longer valid", "warning");
          return false;
        }
        return true;
      } catch {
        isExtensionValid = false;
        captureMessage("Extension context invalidated", "warning");
        return false;
      }
    }

    // Load snippets from the content-script cache in browser.storage.local
    async function loadSnippets() {
      if (!checkExtensionContext()) {
        return;
      }

      try {
        const cached = await cachedSnippetsItem.getValue();
        snippets = cached;
        rebuildShortcutIndex();
      } catch (error) {
        if (
          error instanceof Error &&
          error.message.includes("Extension context invalidated")
        ) {
          isExtensionValid = false;
          captureMessage(
            "Extension context invalidated during loadSnippets",
            "warning"
          );
        } else {
          captureError(error, { action: "loadSnippets" });
        }
      }
    }

    // Find snippet by checking the text before cursor.
    // Delegates to the shared findSnippetMatch helper from content-helpers.
    function findSnippetMatch(
      text: string,
      cursorPosition: number
    ): { snippet: Snippet; startPos: number; endPos: number } | null {
      return findSnippetMatchHelper(text, cursorPosition, shortcutIndex);
    }

    // ── Transformation (placeholders, markdown, HTML) ─────────────────
    // Read clipboard text using the extension's clipboardRead permission.
    // navigator.clipboard.readText() requires transient user-activation AND
    // the host page's Permissions-Policy to allow clipboard-read — both of
    // which are unreliable from a content script (especially after the
    // debounce timer expires). Instead we use a hidden textarea +
    // document.execCommand("paste") which is covered by the extension
    // manifest's "clipboardRead" permission and never prompts the user.
    function readClipboardText(): string {
      const textarea = document.createElement("textarea");
      textarea.style.cssText =
        "position:fixed;left:-9999px;top:-9999px;opacity:0;";
      document.documentElement.appendChild(textarea);
      textarea.focus();
      document.execCommand("paste");
      const text = textarea.value;
      textarea.remove();
      return text;
    }

    // Process snippet content with dynamic placeholders.
    // Delegates to the shared processSnippetContent helper from content-helpers,
    // injecting readClipboardText as the clipboard reader dependency.
    // On clipboard read failure, substitutes "(clipboard unavailable)" and reports to Sentry.
    async function processSnippetContent(
      content: string,
      asHtml: boolean = false
    ): Promise<{ content: string; cursorOffset: number | null }> {
      const safeReadClipboard = (): string => {
        try {
          return readClipboardText();
        } catch (error) {
          console.error("[Clipio] Failed to read clipboard:", error);
          captureError(error, { action: "clipboardRead" });
          return "(clipboard unavailable)";
        }
      };
      return processSnippetContentHelper(content, asHtml, safeReadClipboard);
    }

    // Post-insertion verification: after a short delay, check the field still
    // contains the inserted text (host apps may revert DOM changes).
    function verifyInsertionSuccessForInput(
      element: HTMLInputElement | HTMLTextAreaElement,
      insertedText: string,
      startPos: number
    ): Promise<boolean> {
      if (!insertedText) return Promise.resolve(false);
      return new Promise((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            const actual = element.value;
            const segment = actual.substring(
              startPos,
              startPos + insertedText.length
            );
            resolve(segment === insertedText);
          });
        });
      });
    }

    // Plain text from HTML for contenteditable verification
    function getPlainTextFromHtml(html: string): string {
      const div = document.createElement("div");
      div.innerHTML = html;
      return (div.textContent || "").trim();
    }

    function verifyInsertionSuccessForContentEditable(
      element: HTMLElement,
      insertedHtml: string
    ): Promise<boolean> {
      const expectedPlain = getPlainTextFromHtml(insertedHtml);
      if (!expectedPlain) return Promise.resolve(false);
      return new Promise((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            const actual = element.innerText || element.textContent || "";
            resolve(actual.includes(expectedPlain));
          });
        });
      });
    }

    // Rate-limit "insertion reverted" reports per host to avoid flooding Sentry
    let lastRevertReportTime = 0;
    const REVERT_REPORT_COOLDOWN_MS = 10_000;
    function reportInsertionReverted(elementType: "input" | "contenteditable") {
      const now = Date.now();
      if (now - lastRevertReportTime < REVERT_REPORT_COOLDOWN_MS) return;
      lastRevertReportTime = now;
      captureMessage("Snippet insertion reverted by host", "warning", {
        host: window.location.hostname,
        elementType,
      });
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

      // Empty insertion (e.g. clipboard failed and snippet was only {{clipboard}})
      if (!processedContent) return;

      const textBefore = element.value.substring(0, startPos);
      const textAfter = element.value.substring(endPos);
      element.value = textBefore + processedContent + textAfter;

      // If cursor placeholder was found, position cursor there; otherwise at the end
      const newCursorPos =
        cursorOffset !== null
          ? startPos + cursorOffset
          : startPos + processedContent.length;
      element.setSelectionRange(newCursorPos, newCursorPos);

      justExpanded = true;
      element.dispatchEvent(
        new Event("input", { bubbles: true, cancelable: true })
      );
      element.dispatchEvent(
        new Event("change", { bubbles: true, cancelable: true })
      );
      element.focus();

      const insertionStuck = await verifyInsertionSuccessForInput(
        element,
        processedContent,
        startPos
      );
      if (confettiEnabled && insertionStuck) {
        const pos = getCursorScreenPosition(element);
        showConfetti(pos.x, pos.y);
      } else if (!insertionStuck) {
        reportInsertionReverted("input");
      }

      incrementSnippetUsage(snippet.id).catch((err) => {
        console.error("Failed to increment snippet usage:", err);
      });
    }

    // ── Event handlers ───────────────────────────────────────────────
    // Document-level listeners (capture) so we see all input/keydown/focusout.
    function handleInput(event: Event) {
      if (!isExtensionValid) return;
      if (justExpanded) {
        justExpanded = false;
        return;
      }
      const target = event.target;
      if (
        !target ||
        !(
          target instanceof HTMLInputElement ||
          target instanceof HTMLTextAreaElement
        ) ||
        !target.value
      )
        return;
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
      const { content: processedContent } = await processSnippetContent(
        snippet.content,
        true
      );

      if (!getPlainTextFromHtml(processedContent)) return;

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
      const cursorMarker = element.querySelector('[data-clipio-cursor="true"]');
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

      justExpanded = true;
      element.dispatchEvent(
        new Event("input", { bubbles: true, cancelable: true })
      );

      const insertionStuck = await verifyInsertionSuccessForContentEditable(
        element,
        processedContent
      );
      if (confettiEnabled && insertionStuck) {
        const pos = getCursorScreenPosition(element);
        showConfetti(pos.x, pos.y);
      } else if (!insertionStuck) {
        reportInsertionReverted("contenteditable");
      }

      incrementSnippetUsage(snippet.id).catch(console.error);
    }

    // Handle keydown to expand immediately on Space or Tab
    function handleKeyDown(event: KeyboardEvent) {
      if (!isExtensionValid) return;
      const target = event.target;
      if (!target || !(target instanceof HTMLElement)) return;
      const isInputOrTextarea =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement;
      const isContentEditable = target.isContentEditable;

      if (!isInputOrTextarea && !isContentEditable) return;
      if (event.key !== " " && event.key !== "Tab") return;

      if (typingTimer) clearTimeout(typingTimer);

      if (isInputOrTextarea) {
        const cursorPosition = target.selectionStart ?? target.value.length;
        const match = findSnippetMatch(target.value, cursorPosition);
        if (match) {
          event.preventDefault();
          expandSnippet(target);
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
      if (justExpanded) {
        justExpanded = false;
        return;
      }
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

    // ── Init: storage watchers + document listeners ───────────────────
    async function initialize() {
      if (!checkExtensionContext()) return;
      // Read confetti preference
      try {
        confettiEnabled = await confettiEnabledItem.getValue();
      } catch {
        // keep default true
      }

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

      // Cancel pending expansion when the user leaves the field
      document.addEventListener(
        "focusout",
        () => {
          if (typingTimer) {
            clearTimeout(typingTimer);
            typingTimer = null;
          }
        },
        true
      );

      // Watch for snippet cache and confetti preference changes
      cachedSnippetsItem.watch((newSnippets: Snippet[]) => {
        if (!checkExtensionContext()) return;
        snippets = newSnippets;
        rebuildShortcutIndex();
      });

      confettiEnabledItem.watch((newVal: boolean) => {
        if (!checkExtensionContext()) return;
        confettiEnabled = newVal;
      });
    }

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", initialize);
    } else {
      initialize();
    }
  },
});
