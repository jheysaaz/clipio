import {
  TIMING,
  SENTRY_TEST_MESSAGE_TYPE,
  CONTENT_SCRIPT_PING_MESSAGE_TYPE,
} from "~/config/constants";
import {
  cachedSnippetsItem,
  confettiEnabledItem,
  blockedSitesItem,
  typingTimeoutItem,
  snippetPreviewEnabledItem,
  snippetPreviewPrefixItem,
  snippetPreviewShortcutItem,
} from "~/storage/items";
import { debugLog as _debugLog } from "~/lib/debug";

/**
 * Content-script wrapper around debugLog that automatically appends the
 * current page's origin + pathname (no query string / hash to avoid leaking
 * sensitive data) to every detail object.
 */
function debugLog(
  event: string,
  detail: Record<string, unknown> = {}
): Promise<void> {
  const loc = window.location;
  return _debugLog("content", event, {
    page: loc.origin + loc.pathname,
    ...detail,
  });
}
import {
  incrementSnippetUsage,
  incrementTotalInsertions,
} from "~/utils/usageTracking";
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
import {
  MEDIA_GET_DATA_URL,
  type MediaGetDataUrlResponse,
} from "~/lib/messages";
import { buildGifUrl } from "~/lib/giphy";
import {
  fuzzyMatchSnippets,
  calculatePreviewPosition,
  detectPreviewTrigger,
  type FilteredSnippet,
  type PreviewSettings,
} from "~/lib/preview-helpers";
import { snippetPreviewUI } from "~/lib/snippet-preview-ui";

/**
 * Returns true if `hostname` is covered by any entry in `blockedPatterns`.
 * Supports exact matches (e.g. "example.com") and wildcard subdomain
 * patterns (e.g. "*.example.com" matches "mail.example.com" and
 * "app.sub.example.com" but NOT bare "example.com").
 */
function isHostnameBlocked(
  hostname: string,
  blockedPatterns: string[]
): boolean {
  return blockedPatterns.some((pattern) => {
    if (pattern.startsWith("*.")) {
      const base = pattern.slice(2); // e.g. "example.com"
      return hostname.endsWith("." + base);
    }
    return hostname === pattern;
  });
}

export default defineContentScript({
  matches: ["<all_urls>"],
  runAt: "document_idle",

  main() {
    // ── Sentry (content script) ───────────────────────────────────────
    // Relay transport forwards envelopes via background when host CSP blocks fetch.
    initSentry("content", { transport: makeRelayTransport });

    // ── Always-on ping handler ────────────────────────────────────────
    // Responds to health-check pings from the options page / background.
    // This is NOT dev-only so the Developers > Content Script Health card works
    // in production.
    browser.runtime.onMessage.addListener(
      (
        message: unknown,
        _sender: unknown,
        sendResponse: (r: unknown) => void
      ): boolean | undefined => {
        if (
          typeof message === "object" &&
          message !== null &&
          (message as { type?: string }).type ===
            CONTENT_SCRIPT_PING_MESSAGE_TYPE
        ) {
          sendResponse({ pong: true });
          return true;
        }
        return undefined;
      }
    );

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
    let TYPING_TIMEOUT: number = TIMING.TYPING_TIMEOUT; // overridable via typingTimeoutItem
    let isExtensionValid = true;
    let confettiEnabled = true; // default on; overridden from storage in initialize()
    let justExpanded = false; // guard to skip redundant input events after expansion
    let isBlocked = false; // true when current hostname is in blockedSites

    // ── Preview state ──────────────────────────────────────────────────
    let previewSettings: PreviewSettings = {
      enabled: true,
      triggerPrefix: "/",
      keyboardShortcut: "Ctrl+Shift+Space",
    };
    let lastTriggerState: {
      text: string;
      cursorPos: number;
      element: HTMLElement;
    } | null = null;

    // ── Shortcut lookup index ──────────────────────────────────────────
    let shortcutIndex: ShortcutIndex = { map: new Map(), lengths: [] };

    function rebuildShortcutIndex() {
      shortcutIndex = buildShortcutIndex(snippets);
      debugLog("index:rebuild", { count: snippets.length }).catch(() => {});
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
    // When the snippet contains image placeholders, resolves blobs from the background
    // service worker (which has access to the extension-origin IndexedDB).
    async function processSnippetContent(
      content: string,
      asHtml: boolean = false
    ): Promise<{
      content: string;
      cursorOffset: number | null;
    }> {
      const safeReadClipboard = (): string => {
        try {
          return readClipboardText();
        } catch (error) {
          console.error("[Clipio] Failed to read clipboard:", error);
          captureError(error, { action: "clipboardRead" });
          return "(clipboard unavailable)";
        }
      };

      // Build a resolveMedia function if the content has {{image:...}} placeholders.
      // Blob reads are routed through the background service worker because
      // content scripts in the isolated world access the PAGE's origin IDB,
      // not the extension's origin where blobs are stored.
      let resolveMedia:
        | ((id: string) => { src: string; alt?: string | null } | null)
        | undefined;
      if (asHtml && /\{\{image:[a-f0-9-]+(?::\d+)?\}\}/.test(content)) {
        const idMatches = [
          ...content.matchAll(/\{\{image:([a-f0-9-]+)(?::\d+)?\}\}/g),
        ];
        const uniqueIds = [...new Set(idMatches.map((m) => m[1]))];
        const blobMap = new Map<string, { src: string; alt?: string | null }>();
        await Promise.all(
          uniqueIds.map(async (id) => {
            try {
              const response = (await browser.runtime.sendMessage({
                type: MEDIA_GET_DATA_URL,
                mediaId: id,
              })) as MediaGetDataUrlResponse;
              if (response?.dataUrl) {
                blobMap.set(id, { src: response.dataUrl, alt: response.alt });
              } else {
                captureMessage(
                  "Media blob not found during content expansion",
                  "warning",
                  { mediaId: id }
                );
              }
            } catch (err) {
              captureError(err, { action: "resolveMedia", mediaId: id });
            }
          })
        );
        resolveMedia = (id: string) => blobMap.get(id) ?? null;
      }

      const resolveGif = (id: string) => buildGifUrl(id);

      const result = processSnippetContentHelper(
        content,
        asHtml,
        safeReadClipboard,
        resolveMedia,
        resolveGif
      );
      return result;
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
      if (!expectedPlain) {
        // Image-only snippet: verify by checking whether the element gained
        // at least one <img> element after the insertion.
        if (/<img/i.test(insertedHtml)) {
          return new Promise((resolve) => {
            requestAnimationFrame(() => {
              requestAnimationFrame(() => {
                resolve(element.querySelectorAll("img").length > 0);
              });
            });
          });
        }
        return Promise.resolve(false);
      }
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
      if (!match) {
        debugLog("expand:no-match", {
          text: element.value.slice(-20),
          cursorPos: cursorPosition,
          elementType: element.tagName.toLowerCase(),
        }).catch(() => {});
        return;
      }

      const { snippet, startPos, endPos } = match;
      hidePreview();
      debugLog("expand:match", {
        shortcut: snippet.shortcut,
        label: snippet.label,
        elementType: element.tagName.toLowerCase(),
      }).catch(() => {});

      const t0 = Date.now();
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
      debugLog("expand:done", {
        shortcut: snippet.shortcut,
        stuck: insertionStuck,
        durationMs: Date.now() - t0,
      }).catch(() => {});

      if (confettiEnabled && insertionStuck) {
        const pos = getCursorScreenPosition(element);
        showConfetti(pos.x, pos.y);
      } else if (!insertionStuck) {
        reportInsertionReverted("input");
      }

      incrementSnippetUsage(snippet.id).catch((err) => {
        console.error("Failed to increment snippet usage:", err);
        captureError(err, { action: "incrementUsage", snippetId: snippet.id });
      });
      incrementTotalInsertions().catch(() => {});
    }

    // ── Event handlers ───────────────────────────────────────────────
    // Document-level listeners (capture) so we see all input/keydown/focusout.
    function handleInput(event: Event) {
      if (!isExtensionValid || isBlocked) return;
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
        )
      )
        return;

      if (!target.value) {
        if (typingTimer) clearTimeout(typingTimer);
        hidePreview();
        return;
      }

      // Handle preview trigger detection
      if (previewSettings.enabled) {
        const cursorPos = target.selectionStart || 0;
        console.log("[Clipio Preview] Input detected:", {
          value: target.value,
          cursorPos,
          enabled: previewSettings.enabled,
        });
        handlePreviewTriggerDetection(target, target.value, cursorPos);
      }

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
      hidePreview();
      const text = textNode.textContent || "";

      debugLog("expand:match", {
        shortcut: snippet.shortcut,
        label: snippet.label,
        elementType: "contenteditable",
      }).catch(() => {});

      const t0 = Date.now();
      const { content: processedContent } = await processSnippetContent(
        snippet.content,
        true
      );

      // Allow image-only snippets through — getPlainTextFromHtml returns ""
      // for HTML with no text nodes (e.g. a single <img>), which would
      // incorrectly drop valid image-only snippets.
      if (!processedContent?.trim()) {
        captureMessage(
          "Contenteditable expansion skipped: empty processed content",
          "warning",
          {
            action: "expandSnippetInContentEditable",
            snippetId: snippet.id,
            shortcut: snippet.shortcut,
            host: window.location.hostname,
          }
        );
        debugLog("expand:skipped", {
          reason: "empty-processed-content",
          shortcut: snippet.shortcut,
          elementType: "contenteditable",
        }).catch(() => {});
        return;
      }

      const tempDiv = document.createElement("div");
      tempDiv.innerHTML = processedContent;

      // Locate the cursor marker inside tempDiv BEFORE moving nodes into the
      // fragment — this scopes the lookup to the current insertion only and
      // prevents picking up a stale marker left by a previous expansion.
      const cursorMarker = tempDiv.querySelector(
        '[data-clipio-cursor="true"]'
      ) as HTMLElement | null;

      const textBefore = text.substring(0, startPos);
      const textAfter = text.substring(endPos);

      const fragment = document.createDocumentFragment();
      if (textBefore) fragment.appendChild(document.createTextNode(textBefore));
      while (tempDiv.firstChild) fragment.appendChild(tempDiv.firstChild);
      if (textAfter) fragment.appendChild(document.createTextNode(textAfter));

      const parent = textNode.parentNode;
      if (parent) parent.replaceChild(fragment, textNode);

      // Handle cursor positioning via the marker found above (now live in the DOM)
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
      debugLog("expand:done", {
        shortcut: snippet.shortcut,
        stuck: insertionStuck,
        durationMs: Date.now() - t0,
      }).catch(() => {});

      if (confettiEnabled && insertionStuck) {
        const pos = getCursorScreenPosition(element);
        showConfetti(pos.x, pos.y);
      } else if (!insertionStuck) {
        reportInsertionReverted("contenteditable");
      }

      incrementSnippetUsage(snippet.id).catch((err) => {
        console.error("Failed to increment snippet usage:", err);
        captureError(err, { action: "incrementUsage", snippetId: snippet.id });
      });
      incrementTotalInsertions().catch(() => {});
    }

    // Handle keydown to expand immediately on Space or Tab
    async function handleKeyDown(event: KeyboardEvent) {
      if (!isExtensionValid || isBlocked) return;
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
            await expandSnippetInContentEditable(
              target,
              textNode,
              range,
              match
            );
          }
        }
      }
    }

    // Handle input events for contenteditable
    function handleContentEditableInput(event: Event) {
      if (!isExtensionValid || isBlocked) return;
      if (justExpanded) {
        justExpanded = false;
        return;
      }
      const target = event.target as HTMLElement;
      if (!target.isContentEditable) return;

      // Handle preview trigger detection
      if (previewSettings.enabled) {
        const selection = window.getSelection();
        const cursorPos = selection ? selection.focusOffset : 0;
        handlePreviewTriggerDetection(
          target,
          target.textContent || "",
          cursorPos
        );
      }

      if (!(target.textContent || "")) {
        if (typingTimer) clearTimeout(typingTimer);
        hidePreview();
        return;
      }

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
      } catch (err) {
        captureMessage("Failed to read confetti preference", "warning", {
          action: "initialize",
        });
      }

      // Check blocked sites list — skip expansion on blocked hostnames
      try {
        const blockedSites = await blockedSitesItem.getValue();
        isBlocked = isHostnameBlocked(window.location.hostname, blockedSites);
      } catch (err) {
        captureMessage("Failed to read blocked sites", "warning", {
          action: "initialize",
        });
      }

      // Read user-configured typing timeout (falls back to TIMING.TYPING_TIMEOUT)
      try {
        const stored = await typingTimeoutItem.getValue();
        TYPING_TIMEOUT = Math.max(50, Math.min(2000, stored));
      } catch {
        // Use the compile-time default if storage is unavailable
      }

      // Load preview settings
      try {
        previewSettings.enabled = await snippetPreviewEnabledItem.getValue();
        previewSettings.triggerPrefix =
          await snippetPreviewPrefixItem.getValue();
        previewSettings.keyboardShortcut =
          await snippetPreviewShortcutItem.getValue();
      } catch (err) {
        captureMessage("Failed to load preview settings", "warning", {
          action: "initialize",
        });
      }

      await loadSnippets();

      // Initialize preview UI
      snippetPreviewUI.init();
      snippetPreviewUI.setEventHandlers(
        handlePreviewSnippetSelection,
        hidePreview
      );

      registerRuntimeListeners();
    }

    // ── Preview Helper Functions ──────────────────────────────────────

    function showPreview(
      element: HTMLElement,
      filteredSnippets: FilteredSnippet[],
      query: string
    ): void {
      console.log("[Clipio Preview] showPreview called:", {
        enabled: previewSettings.enabled,
        hasUI: !!snippetPreviewUI,
        snippetCount: filteredSnippets.length,
      });

      if (!previewSettings.enabled || !snippetPreviewUI) {
        return;
      }

      const position = calculatePreviewPosition(element);
      console.log("[Clipio Preview] Position calculated:", position);

      snippetPreviewUI.show(position, filteredSnippets);
      console.log("[Clipio Preview] UI show called");
    }

    function hidePreview(): void {
      snippetPreviewUI.hide();
      lastTriggerState = null;
    }

    function handlePreviewKeyboard(event: KeyboardEvent): boolean {
      if (!previewSettings.enabled || !snippetPreviewUI.isVisible()) {
        return false;
      }

      return snippetPreviewUI.handleKeyDown(event);
    }

    function handlePreviewTriggerDetection(
      element: HTMLElement,
      text: string,
      cursorPos: number
    ): void {
      console.log("[Clipio Preview] Trigger detection:", {
        enabled: previewSettings.enabled,
        text,
        cursorPos,
        prefix: previewSettings.triggerPrefix,
      });

      if (!previewSettings.enabled) return;

      if (!text || cursorPos <= 0) {
        hidePreview();
        return;
      }

      const triggerResult = detectPreviewTrigger(
        text,
        cursorPos,
        previewSettings
      );

      console.log("[Clipio Preview] Trigger result:", triggerResult);

      if (!triggerResult) {
        hidePreview();
        return;
      }

      const { query } = triggerResult;

      // For empty query (just prefix), show all snippets; otherwise filter
      const filteredSnippets =
        query === ""
          ? snippets.map((snippet) => ({
              snippet,
              relevanceScore: 1,
              highlightRanges: [],
            }))
          : fuzzyMatchSnippets(query, snippets);

      console.log("[Clipio Preview] Filtered snippets:", {
        query,
        count: filteredSnippets.length,
        totalSnippets: snippets.length,
      });

      if (filteredSnippets.length === 0) {
        hidePreview();
        return;
      }

      // Store current state for snippet insertion
      lastTriggerState = { text, cursorPos, element };
      showPreview(element, filteredSnippets, query);
    }

    function handlePreviewSnippetSelection(selectedSnippet: FilteredSnippet) {
      if (!lastTriggerState) return;

      const { text, cursorPos, element } = lastTriggerState;
      const triggerResult = detectPreviewTrigger(
        text,
        cursorPos,
        previewSettings
      );

      if (!triggerResult) return;

      const { startPos, endPos } = triggerResult;

      // Insert the snippet using existing expansion logic
      if (
        element instanceof HTMLInputElement ||
        element instanceof HTMLTextAreaElement
      ) {
        insertSnippetInInput(element, selectedSnippet, startPos, endPos);
      } else if (element.isContentEditable) {
        insertSnippetInContentEditable(
          element,
          selectedSnippet,
          startPos,
          endPos
        );
      }

      hidePreview();
    }

    async function insertSnippetInInput(
      element: HTMLInputElement | HTMLTextAreaElement,
      filteredSnippet: FilteredSnippet,
      startPos: number,
      endPos: number
    ) {
      const snippet = filteredSnippet.snippet;
      const beforeText = element.value.substring(0, startPos);
      const afterText = element.value.substring(endPos);

      try {
        const { content: processedContent } = await processSnippetContent(
          snippet.content
        );

        element.value = beforeText + processedContent + afterText;
        const newCursorPos = beforeText.length + processedContent.length;
        element.setSelectionRange(newCursorPos, newCursorPos);

        // Trigger change event
        element.dispatchEvent(new Event("input", { bubbles: true }));

        // Track usage
        await incrementSnippetUsage(snippet.id);
        await incrementTotalInsertions();

        // Show confetti if enabled
        if (confettiEnabled) {
          const rect = element.getBoundingClientRect();
          const pos = {
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2,
          };
          showConfetti(pos.x, pos.y);
        }

        // Mark as just expanded to prevent redundant triggers
        justExpanded = true;
      } catch (error) {
        captureError(error, { action: "insertSnippetInInput" });
      }
    }

    async function insertSnippetInContentEditable(
      element: HTMLElement,
      filteredSnippet: FilteredSnippet,
      startPos: number,
      endPos: number
    ) {
      const snippet = filteredSnippet.snippet;

      try {
        const { content: processedContent } = await processSnippetContent(
          snippet.content
        );

        if (!processedContent?.trim()) {
          captureMessage(
            "Preview insertion skipped: empty processed content",
            "warning",
            {
              action: "insertSnippetInContentEditable",
              snippetId: snippet.id,
              shortcut: snippet.shortcut,
              host: window.location.hostname,
            }
          );
          debugLog("preview:insert-skipped", {
            reason: "empty-processed-content",
            shortcut: snippet.shortcut,
            snippetId: snippet.id,
          }).catch(() => {});
          return;
        }

        // Get text content for manipulation
        const textContent = element.textContent || "";
        const beforeText = textContent.substring(0, startPos);
        const afterText = textContent.substring(endPos);

        // Replace content
        element.textContent = beforeText + processedContent + afterText;

        // Set cursor position
        const range = document.createRange();
        const sel = window.getSelection();
        if (sel && element.firstChild) {
          const newCursorPos = beforeText.length + processedContent.length;
          range.setStart(
            element.firstChild,
            Math.min(newCursorPos, element.textContent?.length || 0)
          );
          range.collapse(true);
          sel.removeAllRanges();
          sel.addRange(range);
        }

        // Trigger input event
        element.dispatchEvent(new Event("input", { bubbles: true }));

        // Track usage
        await incrementSnippetUsage(snippet.id);
        await incrementTotalInsertions();

        // Show confetti if enabled
        if (confettiEnabled) {
          const rect = element.getBoundingClientRect();
          const pos = {
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2,
          };
          showConfetti(pos.x, pos.y);
        }

        // Mark as just expanded to prevent redundant triggers
        justExpanded = true;
      } catch (error) {
        captureError(error, { action: "insertSnippetInContentEditable" });
      }
    }

    function registerRuntimeListeners() {
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
          // Handle preview keyboard navigation first
          if (handlePreviewKeyboard(event)) {
            return; // Preview handled the event
          }

          // Handle global preview keyboard shortcut
          if (previewSettings.enabled) {
            const shortcut = previewSettings.keyboardShortcut.toLowerCase();
            const hasCtrl = shortcut.includes("ctrl")
              ? event.ctrlKey || event.metaKey
              : !event.ctrlKey && !event.metaKey;
            const hasShift = shortcut.includes("shift")
              ? event.shiftKey
              : !event.shiftKey;
            const hasAlt = shortcut.includes("alt")
              ? event.altKey
              : !event.altKey;
            const keyMatch = event.key === " " || event.code === "Space";

            const isShortcutMatch = hasCtrl && hasShift && hasAlt && keyMatch;

            if (isShortcutMatch) {
              const target = event.target as HTMLElement;
              if (
                target.tagName === "INPUT" ||
                target.tagName === "TEXTAREA" ||
                target.isContentEditable
              ) {
                event.preventDefault();
                const text =
                  target.tagName === "INPUT" || target.tagName === "TEXTAREA"
                    ? (target as HTMLInputElement | HTMLTextAreaElement).value
                    : target.textContent || "";
                const cursorPos =
                  target.tagName === "INPUT" || target.tagName === "TEXTAREA"
                    ? (target as HTMLInputElement | HTMLTextAreaElement)
                        .selectionStart || 0
                    : 0; // For contentEditable, would need more complex cursor position detection

                // Manual shortcut intentionally opens preview even on empty input.
                if (!text) {
                  const allSnippets = snippets.map((snippet) => ({
                    snippet,
                    relevanceScore: 1,
                    highlightRanges: [],
                  }));
                  if (allSnippets.length > 0) {
                    lastTriggerState = { text, cursorPos, element: target };
                    showPreview(target, allSnippets, "");
                  } else {
                    hidePreview();
                  }
                } else {
                  handlePreviewTriggerDetection(target, text, cursorPos);
                }
                return;
              }
            }
          }

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
          hidePreview();
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

      // Watch blocklist — dynamically block/unblock this hostname
      blockedSitesItem.watch((newSites: string[]) => {
        if (!checkExtensionContext()) return;
        isBlocked = isHostnameBlocked(window.location.hostname, newSites);
      });

      // Watch typing timeout — apply changes from Developers tab without reload
      typingTimeoutItem.watch((newTimeout: number) => {
        if (!checkExtensionContext()) return;
        TYPING_TIMEOUT = Math.max(50, Math.min(2000, newTimeout));
        debugLog("config:typingTimeout", {
          timeout: newTimeout,
        }).catch(() => {});
      });

      // Watch preview settings — apply changes from Options without reload
      snippetPreviewEnabledItem.watch((newEnabled: boolean) => {
        if (!checkExtensionContext()) return;
        previewSettings.enabled = newEnabled;
        if (!newEnabled) {
          hidePreview();
        }
      });

      snippetPreviewPrefixItem.watch((newPrefix: string) => {
        if (!checkExtensionContext()) return;
        previewSettings.triggerPrefix = newPrefix;
        hidePreview(); // Hide current preview as trigger may have changed
      });

      snippetPreviewShortcutItem.watch((newShortcut: string) => {
        if (!checkExtensionContext()) return;
        previewSettings.keyboardShortcut = newShortcut;
      });

      // Cleanup preview UI on page unload
      window.addEventListener("beforeunload", () => {
        snippetPreviewUI.cleanup();
      });
    }

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", initialize);
    } else {
      initialize();
    }
  },
});
