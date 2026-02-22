import React from "react";
import ReactDOM from "react-dom/client";
import "~/app.css";
import OptionsPage from "~/pages/OptionsPage";
import { Toaster } from "~/components/ui/sonner";
import { ToastProvider } from "~/hooks/ToastContext";
import { ThemeProvider } from "~/hooks/ThemeContext";

function App() {
  return (
    <ThemeProvider>
      <ToastProvider>
        <OptionsPage />
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
