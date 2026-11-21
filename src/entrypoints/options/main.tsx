import React from "react";
import ReactDOM from "react-dom/client";
import { ErrorBoundary } from "@sentry/react";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import "~/app.css";

import {
  legacyHashRedirect,
  optionsHistory,
  routeTree,
} from "@/routes/options";
import "@/store/settings";
import { initSentry, captureError } from "@/lib/sentry";
import { Toaster } from "@/components/ui/toaster";
import { OnboardingLoader } from "@/components/onboarding/OnboardingLoader";
import { i18n } from "#i18n";

initSentry("options");

/**
 * Rewrite a pre-router hash before the router reads it.
 *
 * Options routing shipped as a hand-rolled `hashchange` listener, and two of the
 * hashes it produced name things that were never sections — `#feedback` from the
 * context menu, `#import-export` from the popup's empty state. Those links have
 * been in the wild since then.
 *
 * Done by rewriting `location.hash` rather than by translating inside the router,
 * because the rewrite is what puts the address bar and the app back in
 * agreement. A bookmark left reading `#feedback` while the app believed it was
 * at `#/about/feedback` would make the back button and any copied link disagree
 * with what the user can see.
 */
function applyLegacyHashRedirect(): void {
  const target = legacyHashRedirect(window.location.hash);
  if (!target) return;
  // `replace`, not `location.hash = …`: assigning pushes a history entry, so the
  // Back button would step from `#feedback` to `#feedback` and appear to do
  // nothing.
  window.location.replace(
    `${window.location.pathname}${window.location.search}#${target}`
  );
}

applyLegacyHashRedirect();

const router = createRouter({
  routeTree,
  history: optionsHistory,
  defaultNotFoundComponent: () => null,
});

function ErrorFallback() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
      <p className="text-sm text-destructive font-medium">
        {i18n.t("common.errorOptions")}
      </p>
      <button
        className="text-xs underline text-muted-foreground"
        onClick={() => window.location.reload()}
      >
        {i18n.t("common.reload")}
      </button>
    </div>
  );
}

function App() {
  return (
    <ErrorBoundary
      fallback={<ErrorFallback />}
      onError={(error) => captureError(error, { action: "ReactErrorBoundary" })}
    >
      <RouterProvider router={router} />
      <OnboardingLoader surface="options" />
      <Toaster />
    </ErrorBoundary>
  );
}

const root = document.getElementById("root");

if (root) {
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}
