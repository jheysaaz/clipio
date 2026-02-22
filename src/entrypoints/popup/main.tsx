import React from "react";
import ReactDOM from "react-dom/client";
import "~/app.css";
import Dashboard from "~/pages/Dashboard";
import { Toaster } from "~/components/ui/sonner";
import { ToastProvider } from "~/hooks/ToastContext";
import { ThemeProvider } from "~/hooks/ThemeContext";

function App() {
  return (
    <ThemeProvider>
      <ToastProvider>
        <Dashboard />
        <Toaster />
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
