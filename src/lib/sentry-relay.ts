/**
 * Content-script Sentry relay transport.
 *
 * Content scripts inherit the host page's CSP, which may block direct
 * outbound requests to sentry.io. This module provides a custom Sentry
 * transport that:
 *   1. Attempts a direct fetch() to the Sentry ingest endpoint.
 *   2. On network/CSP failure, falls back to sending the envelope via
 *      browser.runtime.sendMessage() so the background service worker
 *      (which has unrestricted network access) can forward it.
 *
 * Usage: pass `transport: makeRelayTransport` to Sentry.init() in the
 * content script entry point only.
 */

import { makeFetchTransport } from "@sentry/browser";
import type {
  Transport,
  TransportMakeRequestResponse,
  BaseTransportOptions,
  Envelope,
} from "@sentry/core";
import { serializeEnvelope } from "@sentry/core";

export const SENTRY_RELAY_MESSAGE_TYPE = "sentry-relay" as const;

export interface SentryRelayMessage {
  type: typeof SENTRY_RELAY_MESSAGE_TYPE;
  /** Serialized Sentry envelope as a plain string */
  envelope: string;
}

/**
 * Register the relay listener in the background service worker.
 * Call this inside defineBackground() after Sentry has been initialized.
 */
export function registerSentryRelayListener(): void {
  browser.runtime.onMessage.addListener(
    (message: unknown, _sender, sendResponse) => {
      if (
        typeof message === "object" &&
        message !== null &&
        (message as SentryRelayMessage).type === SENTRY_RELAY_MESSAGE_TYPE
      ) {
        const { envelope } = message as SentryRelayMessage;
        const dsn = import.meta.env.WXT_SENTRY_DSN as string | undefined;
        if (!dsn || !envelope) {
          sendResponse({ ok: false });
          return false;
        }

        // Parse the DSN to build the Sentry store endpoint URL
        try {
          const url = new URL(dsn);
          const projectId = url.pathname.replace("/", "");
          const ingestUrl = `${url.protocol}//${url.host}/api/${projectId}/envelope/`;

          fetch(ingestUrl, {
            method: "POST",
            body: envelope,
            headers: { "Content-Type": "application/x-sentry-envelope" },
          })
            .then(() => sendResponse({ ok: true }))
            .catch(() => sendResponse({ ok: false }));
        } catch {
          sendResponse({ ok: false });
        }

        // Return true to indicate we will respond asynchronously
        return true;
      }
      return false;
    }
  );
}

/**
 * A custom Sentry transport factory for content scripts.
 *
 * Tries a direct fetch first; on failure relays through the background.
 */
export function makeRelayTransport(options: BaseTransportOptions): Transport {
  // Build the "direct" transport (fetch preferred)
  const directTransport = makeFetchTransport(options);

  return {
    send: async (envelope: Envelope): Promise<TransportMakeRequestResponse> => {
      try {
        return await directTransport.send(envelope);
      } catch (directError) {
        // Direct fetch was blocked — relay via background service worker
        try {
          const serialized = serializeEnvelope(envelope);
          const message: SentryRelayMessage = {
            type: SENTRY_RELAY_MESSAGE_TYPE,
            envelope:
              typeof serialized === "string"
                ? serialized
                : new TextDecoder().decode(serialized),
          };
          await browser.runtime.sendMessage(message);
          return { statusCode: 200 };
        } catch {
          // Both direct and relay failed — swallow silently to never
          // throw from within the content script error handler
          return { statusCode: 0 };
        }
      }
    },
    flush: async (timeout?: number): Promise<boolean> => {
      if (directTransport.flush) {
        return directTransport.flush(timeout);
      }
      return true;
    },
  };
}
