import { Routes, Route, Navigate } from "react-router";
import { useState, useEffect } from "react";
import Dashboard from "../pages/Dashboard";
import Login from "../pages/Login";
import SignUp from "../pages/SignUp";
import { STORAGE_KEYS } from "../config/constants";

export default function AppRoutes() {
  const [defaultRoute, setDefaultRoute] = useState<string>("/login");

  useEffect(() => {
    const accessToken = localStorage.getItem(STORAGE_KEYS.ACCESS_TOKEN);
    const refreshToken = localStorage.getItem(STORAGE_KEYS.REFRESH_TOKEN);

    if (accessToken && refreshToken) {
      setDefaultRoute("/dashboard");
    } else {
      setDefaultRoute("/login");
    }
  }, []);

  return (
    <Routes>
      <Route path="/" element={<Navigate to={defaultRoute} replace />} />
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<SignUp />} />
      <Route path="/dashboard" element={<Dashboard />} />
    </Routes>
  );
}
