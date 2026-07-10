import {
  Client,
  Scope,
  createStackParser,
  eventFromUnknownInput,
  eventFromMessage as coreEventFromMessage,
  inboundFiltersIntegration,
  linkedErrorsIntegration,
  dedupeIntegration,
} from "@sentry/core";
import type { ClientOptions, EventHint, ErrorEvent } from "@sentry/core";
import type { SeverityLevel } from "@sentry/core";
import { chromeStackLineParser, geckoStackLineParser } from "@sentry/browser";
import { makeRelayTransport } from "./sentry-relay";
import { scrubBreadcrumb, scrubEvent } from "./sentry-scrub";
import { lastSentryErrorAtItem } from "@/storage/items";

/**
 * Concrete client for the content script.
 * Client is declared abstract in @sentry/core types but is instantiable at runtime.
 */
class ContentClient extends Client<ClientOptions> {
  constructor(options: ClientOptions) {
    super(options);
  }

  eventFromException(
    exception: unknown,
    hint?: EventHint
  ): PromiseLike<ErrorEvent> {
    return Promise.resolve(
      eventFromUnknownInput(
        this,
        this._options.stackParser,
        exception,
        hint
      ) as unknown as ErrorEvent
    );
  }

  eventFromMessage(
    message: string,
    level: SeverityLevel = "info",
    hint?: EventHint
  ): PromiseLike<ErrorEvent> {
    return Promise.resolve(
      coreEventFromMessage(
        this._options.stackParser,
        message,
        level,
        hint,
        this._options.attachStacktrace
      ) as unknown as ErrorEvent
    );
  }
}

let extensionScope: Scope | undefined;

export function initSentry(): void {
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
    string | undefined;

  if (!release) {
    try {
      release = browser.runtime.getManifest().version;
    } catch {
      // browser may not be available during unit tests
    }
  }

  const stackParser = createStackParser(
    chromeStackLineParser,
    geckoStackLineParser
  );

  const client = new ContentClient({
    dsn,
    environment,
    release,
    enabled,
    transport: makeRelayTransport,
    stackParser,
    integrations: [
      inboundFiltersIntegration(),
      linkedErrorsIntegration(),
      dedupeIntegration(),
    ],
    maxBreadcrumbs: 20,
    beforeSend(event) {
      return scrubEvent(event as unknown as ErrorEvent) as ErrorEvent | null;
    },
    beforeBreadcrumb(breadcrumb) {
      return scrubBreadcrumb(breadcrumb);
    },
  });

  const scope = new Scope();
  scope.setTag("extension.context", "content");
  try {
    scope.setTag("extension.id", browser.runtime.id);
  } catch {
    scope.setTag("extension.id", "unknown");
  }
  scope.setClient(client);
  client.init();

  extensionScope = scope;
}

export function captureError(
  error: unknown,
  extra?: Record<string, unknown> & { action?: string }
): void {
  lastSentryErrorAtItem.setValue(new Date().toISOString()).catch(() => {});

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
