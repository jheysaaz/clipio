/**
 * Type definitions for the application.
 */

export interface Snippet {
  id: string;
  label: string;
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
