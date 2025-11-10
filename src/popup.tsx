import React, { useState, useEffect } from "react";
import ReactDOM from "react-dom/client";
import { MemoryRouter } from "react-router";
import AppRoutes from "./routes/AppRoutes";
import { useTheme } from "./hooks/useTheme";

function App() {
  const { theme, toggleTheme } = useTheme();
  const [storageType, setStorageType] = useState<"local" | "cloud" | null>(
    null
  );

  useEffect(() => {
    // Check if user has already selected a storage type
    const savedStorageType = localStorage.getItem("storageType") as
      | "local"
      | "cloud"
      | null;
    setStorageType(savedStorageType);
  }, []);

  const handleStorageSelection = (type: "local" | "cloud") => {
    if (type === "local") {
      // Save preference and redirect to dashboard immediately
      localStorage.setItem("storageType", type);
      setStorageType(type);
    }
    // For cloud, navigation is handled by the Login component (redirect to CloudLogin)
  };

  const handleCloudLogin = (email: string, password: string) => {
    // TODO: Implement actual cloud authentication
    console.log("Cloud login:", email);
    localStorage.setItem("storageType", "cloud");
    localStorage.setItem("cloudUser", email);
    setStorageType("cloud");
  };

  const getInitialRoute = () => {
    if (storageType === "local" || storageType === "cloud") {
      return "/dashboard";
    }
    return "/";
  };

  return (
    <MemoryRouter initialEntries={[getInitialRoute()]}>
      <AppRoutes
        theme={theme}
        onToggleTheme={toggleTheme}
        onSelectStorage={handleStorageSelection}
        onCloudLogin={handleCloudLogin}
      />
    </MemoryRouter>
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
