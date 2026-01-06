import {
  API_BASE_URL,
  API_ENDPOINTS,
  STORAGE_KEYS,
  TIMING,
} from "~/config/constants";
import { incrementSnippetUsage } from "~/utils/usageTracking";

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

    let snippets: Snippet[] = [];
    let typingTimer: ReturnType<typeof setTimeout> | null = null;
    const TYPING_TIMEOUT = TIMING.TYPING_TIMEOUT;
    let isExtensionValid = true;

    // Check if extension context is still valid
    function checkExtensionContext(): boolean {
      try {
        // Try to access extension API
        if (!browser.runtime?.id) {
          isExtensionValid = false;
          return false;
        }
        return true;
      } catch (error) {
        isExtensionValid = false;
        return false;
      }
    }

    // Load snippets from storage
    async function loadSnippets() {
      if (!checkExtensionContext()) {
        console.log("[Clipio] Extension context invalidated, stopping");
        return;
      }

      try {
        // First, try to get cached snippets from storage
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
          console.log(
            `[Clipio] Loaded ${snippets.length} cached snippets:`,
            snippets.map((s) => s.shortcut)
          );
          return;
        }

        // If no cache, try to fetch from API (will only work on HTTP pages or with HTTPS API)
        const result = await browser.storage.local.get([
          STORAGE_KEYS.USER_INFO,
          STORAGE_KEYS.ACCESS_TOKEN,
        ]);

        console.log(
          "[Clipio] No cached snippets, attempting to fetch from API..."
        );

        if (
          !result[STORAGE_KEYS.USER_INFO] ||
          !result[STORAGE_KEYS.ACCESS_TOKEN]
        ) {
          console.log("[Clipio] No user info or token found");
          return;
        }

        const userInfo = JSON.parse(result[STORAGE_KEYS.USER_INFO] as string);
        const userId = userInfo.id;
        const accessToken = result[STORAGE_KEYS.ACCESS_TOKEN] as string;

        // Fetch snippets from API
        const response = await fetch(
          API_BASE_URL + API_ENDPOINTS.USER_SNIPPETS,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
          }
        );

        if (response.ok) {
          const data = await response.json();
          snippets = data.snippets || data || [];
          console.log(
            `[Clipio] Loaded ${snippets.length} snippets from API:`,
            snippets.map((s) => s.shortcut)
          );

          // Cache the snippets
          await browser.storage.local.set({
            [STORAGE_KEYS.CACHED_SNIPPETS]: JSON.stringify(snippets),
          });
        } else {
          console.error("[Clipio] Failed to fetch snippets:", response.status);
        }
      } catch (error) {
        // Check if error is due to invalid context
        if (
          error instanceof Error &&
          error.message.includes("Extension context invalidated")
        ) {
          isExtensionValid = false;
          console.log("[Clipio] Extension reloaded, content script stopping");
        } else if (
          error instanceof Error &&
          error.message.includes("Failed to fetch")
        ) {
          console.error(
            "[Clipio] Cannot fetch from API (likely mixed content blocking). Please refresh the extension popup to cache snippets."
          );
        } else {
          console.error("[Clipio] Error loading snippets:", error);
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

      // Check each snippet's shortcut
      for (const snippet of snippets) {
        const shortcut = snippet.shortcut;

        // Check if text before cursor ends with the shortcut
        if (textBeforeCursor.endsWith(shortcut)) {
          const startPos = cursorPosition - shortcut.length;

          // Make sure shortcut is at word boundary (start of text or after space/newline)
          if (startPos === 0 || /[\s\n]/.test(text[startPos - 1])) {
            return {
              snippet,
              startPos,
              endPos: cursorPosition,
            };
          }
        }
      }

      return null;
    }

    // Convert markdown-style formatting to HTML
    function markdownToHtml(content: string): string {
      let html = content;

      // Bold: **text** or __text__
      html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
      html = html.replace(/__(.+?)__/g, "<strong>$1</strong>");

      // Italic: _text_ or *text* (single)
      html = html.replace(
        /(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g,
        "<em>$1</em>"
      );
      html = html.replace(/(?<!_)_(?!_)(.+?)(?<!_)_(?!_)/g, "<em>$1</em>");

      // Strikethrough: ~~text~~
      html = html.replace(/~~(.+?)~~/g, "<s>$1</s>");

      return html;
    }

    // Strip markdown formatting for plain text
    function markdownToPlainText(content: string): string {
      let text = content;

      // Remove bold markers
      text = text.replace(/\*\*(.+?)\*\*/g, "$1");
      text = text.replace(/__(.+?)__/g, "$1");

      // Remove italic markers
      text = text.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "$1");
      text = text.replace(/(?<!_)_(?!_)(.+?)(?<!_)_(?!_)/g, "$1");

      // Remove strikethrough markers
      text = text.replace(/~~(.+?)~~/g, "$1");

      return text;
    }

    // Process snippet content with dynamic placeholders
    async function processSnippetContent(
      content: string,
      asHtml: boolean = false
    ): Promise<string> {
      let processedContent = content;

      // Handle {{clipboard}} placeholder
      if (processedContent.includes("{{clipboard}}")) {
        try {
          const clipboardText = await navigator.clipboard.readText();
          processedContent = processedContent.replace(
            /\{\{clipboard\}\}/g,
            clipboardText
          );
        } catch (error) {
          console.error("[Clipio] Failed to read clipboard:", error);
          // Keep the placeholder if clipboard access fails
        }
      }

      // Convert markdown formatting
      if (asHtml) {
        processedContent = markdownToHtml(processedContent);
      } else {
        processedContent = markdownToPlainText(processedContent);
      }

      return processedContent;
    }

    // Replace shortcut with snippet content
    async function expandSnippet(
      element: HTMLInputElement | HTMLTextAreaElement
    ) {
      if (!isExtensionValid) return;

      const cursorPosition = element.selectionStart || element.value.length;

      const match = findSnippetMatch(element.value, cursorPosition);

      if (!match) return;

      const { snippet, startPos, endPos } = match;

      // Process the snippet content (plain text for input/textarea)
      const processedContent = await processSnippetContent(
        snippet.content,
        false
      );

      // Build new value
      const textBefore = element.value.substring(0, startPos);
      const textAfter = element.value.substring(endPos);
      const newValue = textBefore + processedContent + textAfter;

      // Update the element
      element.value = newValue;

      // Set cursor position after the inserted content
      const newCursorPos = startPos + processedContent.length;
      element.setSelectionRange(newCursorPos, newCursorPos);

      // Trigger events so the page knows the value changed
      const inputEvent = new Event("input", {
        bubbles: true,
        cancelable: true,
      });
      const changeEvent = new Event("change", {
        bubbles: true,
        cancelable: true,
      });
      element.dispatchEvent(inputEvent);
      element.dispatchEvent(changeEvent);

      // Focus the element
      element.focus();

      // Update usage count
      incrementSnippetUsage(snippet.id).catch((err) => {
        console.error("Failed to increment snippet usage:", err);
      });
    }

    // Handle input events with debounce
    function handleInput(event: Event) {
      if (!isExtensionValid) return;

      const target = event.target as HTMLInputElement | HTMLTextAreaElement;

      if (!target || !target.value) return;

      // Clear existing timer
      if (typingTimer) {
        clearTimeout(typingTimer);
      }

      // Set new timer
      typingTimer = setTimeout(() => {
        expandSnippet(target);
      }, TYPING_TIMEOUT);
    }

    // Handle keydown to expand immediately on Space or Tab
    function handleKeyDown(event: KeyboardEvent) {
      if (!isExtensionValid) return;

      const target = event.target as HTMLElement;

      // Check if target is an input, textarea, or contenteditable
      const isInputOrTextarea =
        target.tagName === "INPUT" || target.tagName === "TEXTAREA";
      const isContentEditable = target.isContentEditable;

      if (!isInputOrTextarea && !isContentEditable) return;

      // Check if Space or Tab was pressed
      if (event.key === " " || event.key === "Tab") {
        // Clear typing timer
        if (typingTimer) {
          clearTimeout(typingTimer);
        }

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
          // Handle contenteditable elements
          const selection = window.getSelection();
          if (!selection || selection.rangeCount === 0) return;

          const range = selection.getRangeAt(0);
          const textNode = range.startContainer;

          if (textNode.nodeType === Node.TEXT_NODE) {
            const text = textNode.textContent || "";
            const cursorPos = range.startOffset;
            const match = findSnippetMatch(text, cursorPos);

            if (match) {
              event.preventDefault();
              expandSnippetInContentEditable(target, textNode, range, match);
            }
          }
        }
      }
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

      // Process the snippet content with HTML formatting
      const processedContent = await processSnippetContent(
        snippet.content,
        true
      );

      // Create a temporary container to parse HTML
      const tempDiv = document.createElement("div");
      tempDiv.innerHTML = processedContent;

      // Build new text content
      const textBefore = text.substring(0, startPos);
      const textAfter = text.substring(endPos);

      // Create document fragment with the new content
      const fragment = document.createDocumentFragment();

      if (textBefore) {
        fragment.appendChild(document.createTextNode(textBefore));
      }

      // Add the HTML content
      while (tempDiv.firstChild) {
        fragment.appendChild(tempDiv.firstChild);
      }

      if (textAfter) {
        fragment.appendChild(document.createTextNode(textAfter));
      }

      // Replace the text node with the fragment
      const parent = textNode.parentNode;
      if (parent) {
        parent.replaceChild(fragment, textNode);
      }

      // Trigger input event
      const inputEvent = new Event("input", {
        bubbles: true,
        cancelable: true,
      });
      element.dispatchEvent(inputEvent);

      // Update usage count
      incrementSnippetUsage(snippet.id).catch((err) => {
        console.error("Failed to increment snippet usage:", err);
      });
    }

    // Handle input events for contenteditable
    function handleContentEditableInput(event: Event) {
      if (!isExtensionValid) return;

      const target = event.target as HTMLElement;
      if (!target.isContentEditable) return;

      // Clear existing timer
      if (typingTimer) {
        clearTimeout(typingTimer);
      }

      // Set new timer
      typingTimer = setTimeout(async () => {
        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0) return;

        const range = selection.getRangeAt(0);
        const textNode = range.startContainer;

        if (textNode.nodeType === Node.TEXT_NODE) {
          const text = textNode.textContent || "";
          const cursorPos = range.startOffset;
          const match = findSnippetMatch(text, cursorPos);

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

    // Initialize content script
    async function initialize() {
      console.log("[Clipio] Content script initializing...");

      // Load snippets
      await loadSnippets();

      // Listen for input events on all text inputs, textareas, and contenteditable
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

      // Listen for keydown events for immediate expansion
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
            console.log("[Clipio] Cached snippets changed, reloading...");
            // Parse the new value directly from the change event
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
                console.log(
                  `[Clipio] Reloaded ${snippets.length} snippets:`,
                  snippets.map((s) => s.shortcut)
                );
              }
            } catch (error) {
              console.error("[Clipio] Error parsing updated snippets:", error);
              loadSnippets();
            }
          }
        }
      );

      console.log("[Clipio] Content script initialized successfully");
    }

    // Start the content script
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", initialize);
    } else {
      initialize();
    }
  },
});
