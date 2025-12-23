import React, { useState, useEffect } from "react";
import ReactDOM from "react-dom/client";
import { MemoryRouter } from "react-router";
import { Provider } from "react-redux";
import browser from "webextension-polyfill";
import AppRoutes from "./routes/AppRoutes";
import { store } from "./store";
import { useAppSelector } from "./store/hooks";
import Toast from "./components/Toast";
import { useAppDispatch } from "./store/hooks";
import { hideToast } from "./store/slices/toastSlice";
import { logger } from "./utils/logger";
import { setupOfflineDetection } from "./utils/offline";

function AppContent() {
  const [isLoading, setIsLoading] = useState(true);
  const toast = useAppSelector((state) => state.toast);
  const dispatch = useAppDispatch();

  useEffect(() => {
    // Initialize offline detection
    setupOfflineDetection();
    // Load user data from chrome.storage
    loadUserData();
  }, []);

  const loadUserData = async () => {
    try {
      let accessToken: string | null = null;
      let userInfo: string | null = null;

      // Try to use chrome.storage if available (production)
      if (typeof browser !== "undefined" && browser.storage?.local) {
        const result = await browser.storage.local.get([
          "accessToken",
          "userInfo",
        ]);
        accessToken = (result.accessToken as string) || null;
        userInfo = (result.userInfo as string) || null;
      }

      // Fallback to localStorage (development or if chrome.storage not available)
      if (!accessToken || !userInfo) {
        accessToken = localStorage.getItem("accessToken");
        userInfo = localStorage.getItem("userInfo");
      }

      // Sync with localStorage for compatibility
      if (accessToken) {
        localStorage.setItem("accessToken", accessToken);
      }
      if (userInfo) {
        localStorage.setItem("userInfo", userInfo);
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
      {toast.isVisible && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => dispatch(hideToast())}
        />
      )}
    </MemoryRouter>
  );
}

function App() {
  return (
    <Provider store={store}>
      <AppContent />
    </Provider>
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
