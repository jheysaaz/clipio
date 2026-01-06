import { Routes, Route, Navigate } from "react-router";
import { useState, useEffect } from "react";
import Dashboard from "~/pages/Dashboard";
import Login from "~/pages/Login";
import SignUp from "~/pages/SignUp";
import { STORAGE_KEYS } from "~/config/constants";

export default function AppRoutes() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [isChecking, setIsChecking] = useState(true);

  useEffect(() => {
    const checkAuth = async () => {
      try {
        // Check browser.storage for access token (refresh token is in cookies)
        if (typeof browser !== "undefined" && browser.storage?.local) {
          const result = await browser.storage.local.get([
            STORAGE_KEYS.ACCESS_TOKEN,
          ]);
          if (result[STORAGE_KEYS.ACCESS_TOKEN]) {
            setIsAuthenticated(true);
          } else {
            setIsAuthenticated(false);
          }
        }
      } catch (error) {
        console.error("Error checking auth:", error);
        setIsAuthenticated(false);
      } finally {
        setIsChecking(false);
      }
    };
    checkAuth();
  }, []);

  if (isChecking) {
    return (
      <div className="flex items-center justify-center h-screen">
        <p>Loading...</p>
      </div>
    );
  }

  return (
    <Routes>
      <Route
        path="/"
        element={
          <Navigate to={isAuthenticated ? "/dashboard" : "/login"} replace />
        }
      />
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<SignUp />} />
      <Route path="/dashboard" element={<Dashboard />} />
    </Routes>
  );
}
