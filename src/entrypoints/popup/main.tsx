import React, { lazy, Suspense } from "react";
import ReactDOM from "react-dom/client";
import { ErrorBoundary } from "@sentry/react";
import "~/app.css";
import { RouterProvider, createRouter } from "@tanstack/react-router";
// Importing the settings store for its side effects: it loads the persisted
// theme and font from storage and paints <html> on import. That replaces the
// FontProvider + ThemeProvider pair this tree used to be wrapped in — there is no
// provider to wrap in any more.
import { popupHistory, popupRouteTree } from "@/routes/popup";
import "@/store/settings";
import { initSentry, captureError } from "@/lib/sentry";
import { getOrCreateRoot } from "@/lib/react-root";
import { FeedbackProvider } from "@/components/feedback/FeedbackProvider";
// The tour is not part of opening the popup. Loading it on demand keeps its
// chunk and styles off the critical path for every established user.
const OnboardingLoader = lazy(async () => {
  const module = await import("@/components/onboarding/OnboardingLoader");
  return { default: module.OnboardingLoader };
});

initSentry("popup");

function ErrorFallback() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
      <p className="text-sm text-destructive font-medium">
        {i18n.t("common.errorPopup")}
      </p>
      <button
        className="text-xs underline text-muted-foreground"
        onClick={() => window.location.reload()}
      >
        Reload
      </button>
    </div>
  );
}

const router = createRouter({
  routeTree: popupRouteTree,
  history: popupHistory,
});

function App() {
  return (
    <FeedbackProvider>
      <ErrorBoundary
        fallback={<ErrorFallback />}
        onError={(error) =>
          captureError(error, { action: "ReactErrorBoundary" })
        }
      >
        <RouterProvider router={router} />
        <Suspense fallback={null}>
          <OnboardingLoader surface="popup" />
        </Suspense>
      </ErrorBoundary>
    </FeedbackProvider>
  );
}

const root = document.getElementById("root");

if (root) {
  // A dev reload can re-run this module against the same #root. Rendering into
  // the existing root is the update path React asks for; a second createRoot()
  // on the container leaves two trees fighting over it.
  getOrCreateRoot(root, () => ReactDOM.createRoot(root)).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}
