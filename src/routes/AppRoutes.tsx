import { Routes, Route, Navigate } from "react-router";
import { useState, useEffect } from "react";
import Dashboard from "../pages/Dashboard";
import Login from "../pages/Login";
import SignUp from "../pages/SignUp";
import { STORAGE_KEYS } from "../config/constants";
import { getAccessToken } from "../utils/storage";

export default function AppRoutes() {
  const getInitialRoute = () => {
    const accessToken = localStorage.getItem(STORAGE_KEYS.ACCESS_TOKEN);
    return accessToken ? "/dashboard" : "/login";
  };

  const [defaultRoute, setDefaultRoute] = useState<string>(getInitialRoute());

  useEffect(() => {
    const resolveRoute = async () => {
      try {
        const accessToken = await getAccessToken();
        setDefaultRoute(accessToken ? "/dashboard" : "/login");
      } catch {
        setDefaultRoute("/login");
      }
    };

    void resolveRoute();
  }, []);

  return (
    <Routes>
      <Route path="/" element={<Navigate to={defaultRoute} replace />} />
      <Route path="/login" element={<Login />} />
      <Route path="/sign-up" element={<SignUp />} />
      <Route path="/signup" element={<SignUp />} />
      <Route path="/dashboard" element={<Dashboard />} />
    </Routes>
  );
}
