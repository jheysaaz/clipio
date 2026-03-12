/**
 * Factory functions for creating test snippet data.
 *
 * These create minimal valid Snippet objects for use in E2E tests.
 */

import type { Snippet } from "../../src/types/index.js";

let idCounter = 0;

function nextId(): string {
  idCounter++;
  return `test-snippet-${idCounter.toString().padStart(4, "0")}`;
}

function now(): string {
  return new Date().toISOString();
}

/**
 * Create a single test snippet with sensible defaults.
 * All fields can be overridden via the partial argument.
 */
export function makeSnippet(overrides: Partial<Snippet> = {}): Snippet {
  const id = overrides.id ?? nextId();
  const ts = now();
  return {
    id,
    label: overrides.label ?? `Test Snippet ${id}`,
    shortcut: overrides.shortcut ?? `/test-${id}`,
    content: overrides.content ?? `Content for ${id}`,
    tags: overrides.tags ?? [],
    usageCount: overrides.usageCount ?? 0,
    createdAt: overrides.createdAt ?? ts,
    updatedAt: overrides.updatedAt ?? ts,
  };
}

// ---------------------------------------------------------------------------
// Common test snippets
// ---------------------------------------------------------------------------

/** A simple greeting snippet. */
export function helloSnippet(): Snippet {
  return makeSnippet({
    id: "hello-snippet",
    label: "Hello World",
    shortcut: "/hello",
    content: "Hello, World!",
  });
}

/** A snippet with a {{cursor}} placeholder. */
export function cursorSnippet(): Snippet {
  return makeSnippet({
    id: "cursor-snippet",
    label: "Cursor Placeholder",
    shortcut: "/cursor",
    content: "Dear {{cursor}}, Thank you!",
  });
}

/** A snippet with a {{clipboard}} placeholder. */
export function clipboardSnippet(): Snippet {
  return makeSnippet({
    id: "clipboard-snippet",
    label: "Clipboard Snippet",
    shortcut: "/clip",
    content: "Copied: {{clipboard}}",
  });
}

/** A snippet with a {{date:iso}} placeholder. */
export function dateSnippet(): Snippet {
  return makeSnippet({
    id: "date-snippet",
    label: "Date Snippet",
    shortcut: "/date",
    content: "Today is {{date:iso}}",
  });
}

/** A snippet with markdown formatting. */
export function markdownSnippet(): Snippet {
  return makeSnippet({
    id: "markdown-snippet",
    label: "Markdown Snippet",
    shortcut: "/md",
    content: "**Bold text** and _italic text_",
  });
}

/** A multi-line snippet for textarea testing. */
export function multilineSnippet(): Snippet {
  return makeSnippet({
    id: "multiline-snippet",
    label: "Multiline Snippet",
    shortcut: "/multi",
    content: "Line 1\nLine 2\nLine 3",
  });
}

/** A short shortcut snippet (for "longest match" testing). */
export function shortShortcutSnippet(): Snippet {
  return makeSnippet({
    id: "short-shortcut",
    label: "Short Shortcut",
    shortcut: "/h",
    content: "Short content",
  });
}

/** A long shortcut snippet (for "longest match" testing — wins over /h). */
export function longShortcutSnippet(): Snippet {
  return makeSnippet({
    id: "long-shortcut",
    label: "Long Shortcut",
    shortcut: "/hello",
    content: "Long shortcut content",
  });
}

/** Create N snippets quickly for bulk/quota testing. */
export function makeSnippets(
  count: number,
  overrides: (i: number) => Partial<Snippet> = () => ({})
): Snippet[] {
  return Array.from({ length: count }, (_, i) => makeSnippet(overrides(i)));
}

/**
 * Reset the ID counter. Call at the start of tests that depend on
 * predictable IDs (e.g., migration tests).
 */
export function resetIdCounter(): void {
  idCounter = 0;
}
