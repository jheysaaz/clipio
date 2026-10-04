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

import { createTransport, serializeEnvelope } from "@sentry/core";
import type {
  Transport,
  TransportMakeRequestResponse,
  BaseTransportOptions,
  Envelope,
} from "@sentry/core";

import { MESSAGE, onMessageFromSelf, sendMessage } from "@/lib/protocol";

/**
 * Register the relay listener in the background service worker.
 * Call this inside defineBackground() after Sentry has been initialized.
 *
 * The sender check is not written here: `onMessageFromSelf` performs it for
 * every handler in the extension and throws `UntrustedSenderError` when it
 * fails. That matters more here than anywhere else — this handler POSTs to
 * whatever endpoint the extension's DSN names, so a page able to reach it could
 * exfiltrate through the user's browser. See docs/decisions/0009.
 */
export function registerSentryRelayListener(): void {
  onMessageFromSelf(MESSAGE.SENTRY_RELAY, async ({ data }) => {
    const { envelope } = data;
    const dsn = import.meta.env.WXT_SENTRY_DSN as string | undefined;
    if (!dsn || !envelope) return { ok: false };

    // Parse the DSN to build the Sentry store endpoint URL
    let ingestUrl: string;
    try {
      const url = new URL(dsn);
      const projectId = url.pathname.replace("/", "");
      ingestUrl = `${url.protocol}//${url.host}/api/${projectId}/envelope/`;
    } catch {
      return { ok: false };
    }

    try {
      await fetch(ingestUrl, {
        method: "POST",
        body: envelope,
        headers: { "Content-Type": "application/x-sentry-envelope" },
      });
      return { ok: true };
    } catch {
      return { ok: false };
    }
  });
}

/**
 * A custom Sentry transport factory for content scripts.
 *
 * Tries a direct fetch first; on failure relays through the background.
 */
export function makeRelayTransport(options: BaseTransportOptions): Transport {
  // Build the "direct" transport using a simple fetch-based request
  const directTransport = createTransport(options, async (request) => {
    const body =
      typeof request.body === "string"
        ? request.body
        : new TextDecoder().decode(request.body);
    const response = await fetch(options.url, {
      body,
      method: "POST",
      referrerPolicy: "strict-origin",
      headers: options.headers,
    });
    return {
      statusCode: response.status,
      headers: {
        "x-sentry-rate-limits": response.headers.get("X-Sentry-Rate-Limits"),
        "retry-after": response.headers.get("Retry-After"),
      },
    };
  });

  return {
    send: async (envelope: Envelope): Promise<TransportMakeRequestResponse> => {
      try {
        return await directTransport.send(envelope);
      } catch {
        // Direct fetch was blocked — relay via background service worker
        try {
          const serialized = serializeEnvelope(envelope);
          await sendMessage(MESSAGE.SENTRY_RELAY, {
            envelope:
              typeof serialized === "string"
                ? serialized
                : new TextDecoder().decode(serialized),
          });
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
