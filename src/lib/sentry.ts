/**
 * Shared Sentry initialization and error-capture helpers.
 *
 * Follows Sentry's browser-extension best practices: we do NOT use Sentry.init()
 * so we avoid polluting global state and leaking events between the extension
 * and the host page. Instead we create a manual BrowserClient + Scope per context
 * and capture only via that scope.
 *
 * Call initSentry(context) once at the top of each entry point:
 *   - background.ts       → initSentry('background')
 *   - popup/main.tsx      → initSentry('popup')
 *   - options/main.tsx    → initSentry('options')
 *   - content.ts          → initSentry('content', { transport: makeRelayTransport })
 *
 * The DSN is read from WXT_SENTRY_DSN (set in .env / .env.production).
 * Sentry is a no-op when the DSN is absent, preventing any overhead during
 * local development unless explicitly enabled.
 */

import {
  BrowserClient,
  Scope,
  getDefaultIntegrations,
  makeFetchTransport,
  defaultStackParser,
  browserTracingIntegration,
} from "@sentry/browser";
import { captureFeedback as coreCaptureFeedback } from "@sentry/core";
import type { Transport, BaseTransportOptions } from "@sentry/core";
import type { SeverityLevel } from "@sentry/core";
import { scrubBreadcrumb, scrubEvent } from "./sentry-scrub";
import type { ErrorEvent } from "@sentry/browser";

export type SentryContext = "background" | "popup" | "options" | "content";

interface InitOptions {
  /**
   * Override the transport factory. Used by the content script to inject
   * the relay transport (makeRelayTransport from sentry-relay.ts).
   */
  transport?: (options: BaseTransportOptions) => Transport;
}

/** Integrations that use global state; excluded per Sentry browser-extension guide. */
const GLOBAL_STATE_INTEGRATION_NAMES = new Set([
  "BrowserApiErrors",
  "BrowserSession",
  "Breadcrumbs",
  "ConversationId",
  "GlobalHandlers",
  "FunctionToString",
]);

/** Module-level extension scope; set by initSentry and used by capture helpers. */
let extensionScope: Scope | undefined;

/**
 * Initialize Sentry for the given extension context using a manual client + scope
 * (no Sentry.init()) so the extension does not pollute global state.
 * Safe to call multiple times per context — we only set extensionScope once per context.
 */
export function initSentry(
  context: SentryContext,
  { transport }: InitOptions = {}
): void {
  const dsn = import.meta.env.WXT_SENTRY_DSN as string | undefined;

  if (!dsn) return;

  const environment =
    (import.meta.env.MODE as string) === "production"
      ? "production"
      : "development";

  const enabledEnv = import.meta.env.WXT_SENTRY_ENABLED as string | undefined;
  const enabled =
    enabledEnv !== undefined
      ? enabledEnv === "true"
      : environment === "production";

  if (!enabled) return;

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

  const defaultIntegrations = getDefaultIntegrations({});
  const filtered = defaultIntegrations.filter(
    (integration) => !GLOBAL_STATE_INTEGRATION_NAMES.has(integration.name)
  );
  const integrations = [
    ...filtered,
    browserTracingIntegration(),
  ];

  const transportFactory = transport ?? makeFetchTransport;

  const client = new BrowserClient({
    dsn,
    environment,
    release,
    enabled,
    transport: transportFactory,
    stackParser: defaultStackParser,
    integrations,
    maxBreadcrumbs: 20,
    tracesSampleRate: 0.2,
    beforeSend(event) {
      return scrubEvent(event as ErrorEvent) as ErrorEvent | null;
    },
    beforeBreadcrumb(breadcrumb) {
      return scrubBreadcrumb(breadcrumb);
    },
  });

  const scope = new Scope();
  scope.setTag("extension.context", context);
  try {
    scope.setTag("extension.id", browser.runtime.id);
  } catch {
    scope.setTag("extension.id", "unknown");
  }
  scope.setClient(client);
  client.init();

  extensionScope = scope;
}

/**
 * Capture a thrown error with optional extra context.
 * Uses the extension scope so the event goes to our project.
 */
export function captureError(
  error: unknown,
  extra?: Record<string, unknown> & { action?: string }
): void {
  if (!extensionScope) return;
  if (extra?.action) {
    extensionScope.setTag("action", extra.action);
  }
  if (extra) {
    const { action: _action, ...rest } = extra;
    if (Object.keys(rest).length) {
      extensionScope.setExtras(rest as Record<string, unknown>);
    }
  }
  extensionScope.captureException(error);
}

/**
 * Capture a message with an optional severity level and extra context.
 * Uses the extension scope so the event goes to our project.
 */
export function captureMessage(
  message: string,
  level: SeverityLevel = "info",
  extra?: Record<string, unknown>
): void {
  if (!extensionScope) return;
  if (extra) {
    extensionScope.setExtras(extra);
  }
  extensionScope.captureMessage(message, level);
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
 * Send user feedback to Sentry via the extension client.
 * Optionally attach a screenshot file.
 * Uses the extension scope so feedback goes to our project.
 */
export async function sendUserFeedback(params: {
  name?: string;
  email?: string;
  message: string;
  screenshot?: File;
}): Promise<void> {
  if (!extensionScope) {
    throw new Error("Sentry not initialized");
  }

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

  const feedbackId = coreCaptureFeedback(
    {
      message: params.message,
      name: params.name,
      email: params.email,
    },
    attachments ? { attachments } : undefined,
    extensionScope
  );

  if (!feedbackId) {
    throw new Error("Failed to send feedback");
  }
}

// Re-export Sentry for callers that need it (e.g. ErrorBoundary fallbackProps)
export { getClient, getCurrentScope } from "@sentry/core";
export * as Sentry from "@sentry/browser";
