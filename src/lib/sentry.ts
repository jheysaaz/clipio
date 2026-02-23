/**
 * Shared Sentry initialization and error-capture helpers.
 *
 * Call initSentry(context) once at the top of each entry point:
 *   - background.ts       → initSentry('background')
 *   - popup/main.tsx      → initSentry('popup')
 *   - options/main.tsx    → initSentry('options')
 *   - content.ts          → initSentry('content')
 *
 * The DSN is read from WXT_SENTRY_DSN (set in .env / .env.production).
 * Sentry is a no-op when the DSN is absent, preventing any overhead during
 * local development unless explicitly enabled.
 */

import * as Sentry from "@sentry/browser";
import { scrubBreadcrumb, scrubEvent } from "./sentry-scrub";
import type { Transport, BaseTransportOptions } from "@sentry/core";

export type SentryContext = "background" | "popup" | "options" | "content";

interface InitOptions {
  /**
   * Override the transport factory. Used by the content script to inject
   * the relay transport (makeRelayTransport from sentry-relay.ts).
   */
  transport?: (options: BaseTransportOptions) => Transport;
}

/**
 * Initialize Sentry for the given extension context.
 * Safe to call multiple times — Sentry deduplicates re-initialization.
 */
export function initSentry(
  context: SentryContext,
  { transport }: InitOptions = {}
): void {
  const dsn = import.meta.env.WXT_SENTRY_DSN as string | undefined;

  // Disable Sentry when no DSN is configured
  if (!dsn) return;

  const environment =
    (import.meta.env.MODE as string) === "production"
      ? "production"
      : "development";

  // Respect explicit WXT_SENTRY_ENABLED override; otherwise only enable in prod
  const enabledEnv = import.meta.env.WXT_SENTRY_ENABLED as string | undefined;
  const enabled =
    enabledEnv !== undefined
      ? enabledEnv === "true"
      : environment === "production";

  if (!enabled) return;

  // Derive release from env var or manifest version
  let release: string | undefined = import.meta.env.WXT_SENTRY_RELEASE as
    | string
    | undefined;

  if (!release) {
    try {
      release = browser.runtime.getManifest().version;
    } catch {
      // browser may not be available during unit tests
    }
  }

  Sentry.init({
    dsn,
    environment,
    release,
    enabled,

    // Custom transport for content scripts (relay through background on CSP block)
    ...(transport ? { transport } : {}),

    // Keep breadcrumb trail lean — 20 is enough for extension debugging
    maxBreadcrumbs: 20,

    // Moderate PII scrubbing: strip content fields but keep stack traces
    beforeSend(event) {
      return scrubEvent(event) as Sentry.ErrorEvent;
    },
    beforeBreadcrumb(breadcrumb) {
      return scrubBreadcrumb(breadcrumb);
    },

    // Tag every event with its origin context for Sentry dashboard filtering
    initialScope: {
      tags: {
        "extension.context": context,
        "extension.id": (() => {
          try {
            return browser.runtime.id;
          } catch {
            return "unknown";
          }
        })(),
      },
    },
  });
}

// ---------------------------------------------------------------------------
// Convenience wrappers
// ---------------------------------------------------------------------------

/**
 * Capture a thrown error with optional extra context.
 * `action` is added as a tag so errors can be grouped by operation in Sentry.
 */
export function captureError(
  error: unknown,
  extra?: Record<string, unknown> & { action?: string }
): void {
  Sentry.withScope((scope) => {
    if (extra?.action) {
      scope.setTag("action", extra.action);
    }
    if (extra) {
      const { action: _action, ...rest } = extra;
      if (Object.keys(rest).length) {
        scope.setExtras(rest as Record<string, unknown>);
      }
    }
    Sentry.captureException(error);
  });
}

/**
 * Capture a message with an optional severity level and extra context.
 */
export function captureMessage(
  message: string,
  level: Sentry.SeverityLevel = "info",
  extra?: Record<string, unknown>
): void {
  Sentry.withScope((scope) => {
    if (extra) {
      scope.setExtras(extra);
    }
    Sentry.captureMessage(message, level);
  });
}

/**
 * Reads a File into a Uint8Array.
 */
function readFileAsUint8Array(file: File): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(new Error("Failed to read screenshot file"));
    reader.readAsArrayBuffer(file);
  });
}

/**
 * Send user feedback to Sentry via the feedback integration.
 * Optionally attach a screenshot file.
 * Returns a promise that resolves when feedback is sent, or rejects with an error.
 */
export async function sendUserFeedback(params: {
  name?: string;
  email?: string;
  message: string;
  screenshot?: File;
}): Promise<void> {
  // Read screenshot bytes before calling Sentry — withScope() is synchronous
  // so attaching inside a FileReader.onload callback would be too late.
  let attachments:
    | { filename: string; data: Uint8Array; contentType: string }[]
    | undefined;

  if (params.screenshot) {
    const data = await readFileAsUint8Array(params.screenshot);
    attachments = [
      {
        filename: params.screenshot.name,
        data,
        contentType: params.screenshot.type,
      },
    ];
  }

  const feedbackId = Sentry.captureFeedback(
    {
      message: params.message,
      name: params.name,
      email: params.email,
    },
    // Pass attachments via the event hint so they travel with the feedback event
    attachments ? { attachments } : undefined
  );

  if (!feedbackId) {
    throw new Error("Failed to send feedback");
  }
}

// Re-export core Sentry so callers only need one import
export { Sentry };
