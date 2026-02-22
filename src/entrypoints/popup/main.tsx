import React, { lazy, Suspense } from "react";
import ReactDOM from "react-dom/client";
import "~/app.css";
import Dashboard from "~/pages/Dashboard";
import { ToastProvider } from "~/hooks/ToastContext";
import { ThemeProvider } from "~/hooks/ThemeContext";

const Toaster = lazy(() =>
  import("~/components/ui/sonner").then((m) => ({ default: m.Toaster }))
);

function App() {
  return (
    <ThemeProvider>
      <ToastProvider>
        <Dashboard />
        <Suspense>
          <Toaster />
        </Suspense>
      </ToastProvider>
    </ThemeProvider>
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
