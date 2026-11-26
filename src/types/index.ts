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
  /**
   * Monotonic write revision. Records written before this field existed are
   * normalised to 0 on read, so it is optional at the storage boundary.
   */
  rev?: number;
  /**
   * Stable id of the writer that produced `rev`. Legacy records use "unknown".
   * It is the last tie-break in last-writer-wins resolution.
   */
  updatedBy?: string;
}

/** Why a snapshot was written to local version history. */
export type SnippetEditReason =
  "edit" | "delete" | "restore" | "import" | "conflict";

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
export function createSnippet(
  form: SnippetFormData,
  writerId = "unknown"
): Snippet {
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
    rev: 1,
    updatedBy: writerId,
  };
}
