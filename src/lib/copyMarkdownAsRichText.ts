/**
 * Shared helper: serialize Clipio Markdown to both rich HTML and plain text
 * and write them to the system clipboard as a single ClipboardItem.
 *
 * Images referenced by {{image:<uuid>}} or {{image:<uuid>:<width>}} are
 * resolved from IndexedDB and embedded as base64 data URLs so the pasted
 * HTML is fully self-contained. Stored alt text (MediaMetadata.alt) is
 * injected into each <img> tag.
 *
 * GIFs ({{gif:<id>}}) are already converted to live Giphy CDN URLs by
 * markdownToHtml and require no local blob resolution.
 *
 * @throws Error if the Clipboard API write fails (caller should surface to user).
 */

import { markdownToHtml, markdownToPlainText } from "./markdown";
import { getMedia } from "~/storage/backends/media";
import { captureError } from "~/lib/sentry";

export async function copyMarkdownAsRichText(markdown: string): Promise<void> {
  const plainText = markdownToPlainText(markdown);
  let html = markdownToHtml(markdown);

  // Collect all unique image UUIDs (with optional :width suffix)
  const imageRefs = [
    ...markdown.matchAll(/\{\{image:([a-f0-9-]+)(?::\d+)?\}\}/g),
  ];

  if (imageRefs.length > 0) {
    const replacements = await Promise.all(
      imageRefs.map(async (match) => {
        const id = match[1];
        try {
          const entry = await getMedia(id);
          if (!entry) return { id, dataUrl: null, alt: null };
          const dataUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(entry.blob);
          });
          return { id, dataUrl, alt: entry.alt ?? null };
        } catch (err) {
          captureError(err, { action: "copy.resolveMedia", mediaId: id });
          return { id, dataUrl: null, alt: null };
        }
      })
    );

    for (const { id, dataUrl, alt } of replacements) {
      if (dataUrl) {
        const altAttr = alt ? ` alt="${alt.replace(/"/g, "&quot;")}"` : "";
        // Replace the placeholder <img data-clipio-media="<id>" alt="..."> with
        // the resolved <img src="data:..."> preserving any other attributes
        // (e.g. style with width/max-width).
        html = html.replace(
          new RegExp(
            `<img data-clipio-media="${id}" alt="[^"]*"([^>]*)/>`,
            "g"
          ),
          `<img src="${dataUrl}"${altAttr}$1/>`
        );
      } else {
        // Unresolvable — remove the img tag and leave a text fallback
        html = html.replace(
          new RegExp(`<img data-clipio-media="${id}"[^>]*/>`, "g"),
          "[image]"
        );
      }
    }
  }

  const clipboardItem = new ClipboardItem({
    "text/plain": new Blob([plainText], { type: "text/plain" }),
    "text/html": new Blob([html], { type: "text/html" }),
  });

  await navigator.clipboard.write([clipboardItem]);
}
