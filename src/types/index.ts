/**
 * Type definitions for the application.
 */

/**
 * Snippet content is always markdown.
 *
 * The former `contentFormat: "markdown" | "html"` field was retired: the editor
 * always serialised markdown while the flag was carried forward onto the
 * markdown body, so opening and saving an HTML-format snippet corrupted it.
 * Legacy HTML bodies are converted once, on read — see
 * specs/content-format-migration.spec.md.
 */
export interface Snippet {
  id: string;
  label: string;
  /** Always markdown. */
  content: string;
  shortcut: string;
  tags?: string[];
  usageCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface SnippetFormData {
  label: string;
  shortcut: string;
  content: string;
  tags?: string[];
}

/**
 * Creates a new Snippet from form data, generating a client-side ID
 * and timestamps. No server required.
 */
export function createSnippet(form: SnippetFormData): Snippet {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    label: form.label,
    shortcut: form.shortcut,
    content: form.content,
    tags: form.tags ?? [],
    usageCount: 0,
    createdAt: now,
    updatedAt: now,
  };
}
