/**
 * Typed message constants and interfaces for background ↔ content-script
 * communication via browser.runtime.sendMessage / onMessage.
 *
 * Each message type is a discriminated union member so TypeScript can
 * narrow the message shape inside onMessage listeners.
 */

// ---------------------------------------------------------------------------
// media-get-data-url
// ---------------------------------------------------------------------------
// Purpose: content script requests a media blob from the background,
// which has access to the extension-origin IndexedDB where blobs are stored.
// Content scripts running in the isolated world see the PAGE's origin IDB,
// not the extension's, so all blob reads must go through the background.

export const MEDIA_GET_DATA_URL = "media-get-data-url" as const;

export interface MediaGetDataUrlRequest {
  type: typeof MEDIA_GET_DATA_URL;
  mediaId: string;
}

export interface MediaGetDataUrlResponse {
  dataUrl: string | null;
  alt?: string | null;
}
