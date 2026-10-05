import React from "react";
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
import { Toaster } from "@/components/ui/toaster";

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
    <ErrorBoundary
      fallback={<ErrorFallback />}
      onError={(error) => captureError(error, { action: "ReactErrorBoundary" })}
    >
      <RouterProvider router={router} />
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
