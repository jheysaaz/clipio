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

// Re-export core Sentry so callers only need one import
export { Sentry };

// ---------------------------------------------------------------------------
// Dev helpers
// ---------------------------------------------------------------------------

/**
 * Fire a test exception and a test message to Sentry.
 * Only intended for development — use to verify the DSN and integration work.
 */
export function sendTestError(): void {
  Sentry.withScope((scope) => {
    scope.setTag("test", "true");
    scope.setExtra("triggeredAt", new Date().toISOString());
    scope.setExtra("source", "sendTestError()");
    Sentry.captureException(
      new Error("[Clipio] Sentry test error — feel free to ignore")
    );
  });
  captureMessage("[Clipio] Sentry test message", "info", { test: true });
  console.info("[Clipio] Test error sent to Sentry.");
}
