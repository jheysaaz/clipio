import React from "react";
import ReactDOM from "react-dom/client";
import { ErrorBoundary } from "@sentry/react";
import "~/app.css";
import OptionsPage from "~/pages/OptionsPage";
import { ThemeProvider } from "~/hooks/ThemeContext";
import { initSentry } from "~/lib/sentry";

initSentry("options");

function ErrorFallback() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
      <p className="text-sm text-destructive font-medium">
        Something went wrong. Please reload the options page.
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

function App() {
  return (
    <ErrorBoundary fallback={<ErrorFallback />}>
      <ThemeProvider>
        <OptionsPage />
      </ThemeProvider>
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
