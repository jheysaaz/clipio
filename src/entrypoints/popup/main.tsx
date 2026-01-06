import React, { useState, useEffect } from "react";
import ReactDOM from "react-dom/client";
import { MemoryRouter } from "react-router";
import "~/app.css";
import AppRoutes from "~/routes/AppRoutes";
import { Toaster } from "~/components/ui/sonner";
import { ToastProvider } from "~/hooks/ToastContext";
import { ThemeProvider } from "~/hooks/ThemeContext";
import { logger } from "~/utils/logger";

function AppContent() {
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Load user data from browser.storage
    loadUserData();
  }, []);

  const loadUserData = async () => {
    try {
      // Only use browser.storage for consistency
      if (typeof browser !== "undefined" && browser.storage?.local) {
        const result = await browser.storage.local.get([
          "accessToken",
          "userInfo",
        ]);
        // Data is already loaded, no need to sync with localStorage
      }
    } catch (error) {
      logger.error("Error loading user data", { data: { error } });
    } finally {
      setIsLoading(false);
    }
  };

  const getInitialRoute = () => {
    return "/";
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <p>Loading...</p>
      </div>
    );
  }

  return (
    <MemoryRouter initialEntries={[getInitialRoute()]}>
      <AppRoutes />
      <Toaster />
    </MemoryRouter>
  );
}

function App() {
  return (
    <ThemeProvider>
      <ToastProvider>
        <AppContent />
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
