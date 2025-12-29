import browser from "webextension-polyfill";
import {
  API_BASE_URL,
  API_ENDPOINTS,
  STORAGE_KEYS,
  TIMING,
} from "./config/constants";
import { incrementSnippetUsage } from "./utils/usageTracking";

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

    console.log("[Clipio] No cached snippets, attempting to fetch from API...");

    if (!result[STORAGE_KEYS.USER_INFO] || !result[STORAGE_KEYS.ACCESS_TOKEN]) {
      console.log("[Clipio] No user info or token found");
      return;
    }

    const userInfo = JSON.parse(result[STORAGE_KEYS.USER_INFO] as string);
    const userId = userInfo.id;
    const accessToken = result[STORAGE_KEYS.ACCESS_TOKEN] as string;

    // Fetch snippets from API
    const response = await fetch(API_BASE_URL + API_ENDPOINTS.USER_SNIPPETS, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

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
// Replace shortcut with snippet content
function expandSnippet(element: HTMLInputElement | HTMLTextAreaElement) {
  if (!isExtensionValid) return;

  const cursorPosition = element.selectionStart || element.value.length;

  const match = findSnippetMatch(element.value, cursorPosition);

  if (!match) return;

  const { snippet, startPos, endPos } = match;

  // Build new value
  const textBefore = element.value.substring(0, startPos);
  const textAfter = element.value.substring(endPos);
  const newValue = textBefore + snippet.content + textAfter;

  // Update the element
  element.value = newValue;

  // Set cursor position after the inserted content
  const newCursorPos = startPos + snippet.content.length;
  element.setSelectionRange(newCursorPos, newCursorPos);

  // Trigger events so the page knows the value changed
  const inputEvent = new Event("input", { bubbles: true, cancelable: true });
  const changeEvent = new Event("change", { bubbles: true, cancelable: true });
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

  const target = event.target as HTMLInputElement | HTMLTextAreaElement;

  // Check if Space or Tab was pressed
  if (event.key === " " || event.key === "Tab") {
    // Clear typing timer
    if (typingTimer) {
      clearTimeout(typingTimer);
    }

    // Check for snippet expansion immediately
    const cursorPosition = target.selectionStart || target.value.length;
    const match = findSnippetMatch(target.value, cursorPosition);

    if (match) {
      event.preventDefault();
      expandSnippet(target);
    }
  }
}

// Initialize content script
async function initialize() {
  console.log("[Clipio] Content script initializing...");

  // Load snippets
  await loadSnippets();

  // Listen for input events on all text inputs and textareas
  document.addEventListener(
    "input",
    (event) => {
      const target = event.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") {
        handleInput(event);
      }
    },
    true
  );

  // Listen for keydown events for immediate expansion
  document.addEventListener(
    "keydown",
    (event) => {
      const target = event.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") {
        handleKeyDown(event);
      }
    },
    true
  );

  // Reload snippets when storage changes
  browser.storage.onChanged.addListener((changes, areaName) => {
    if (!checkExtensionContext()) return;

    if (areaName === "local") {
      console.log("[Clipio] Storage changed, reloading snippets...");
      loadSnippets();
    }
  });

  console.log("[Clipio] Content script initialized successfully");
}

// Start the content script
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initialize);
} else {
  initialize();
}
