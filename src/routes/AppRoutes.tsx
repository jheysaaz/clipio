import { Routes, Route } from "react-router";
import Dashboard from "../pages/Dashboard";
import Login from "../pages/Login";
import CloudLogin from "../pages/CloudLogin";

interface AppRoutesProps {
  theme: "light" | "dark";
  onToggleTheme: () => void;
  onSelectStorage: (type: "local" | "cloud") => void;
  onCloudLogin: (email: string, password: string) => void;
}

export default function AppRoutes({
  theme,
  onToggleTheme,
  onSelectStorage,
  onCloudLogin,
}: AppRoutesProps) {
  return (
    <Routes>
      <Route
        path="/"
        element={<Login theme={theme} onSelectStorage={onSelectStorage} />}
      />
      <Route
        path="/cloud-login"
        element={<CloudLogin theme={theme} onLogin={onCloudLogin} />}
      />
      <Route
        path="/dashboard"
        element={<Dashboard theme={theme} onToggleTheme={onToggleTheme} />}
      />
    </Routes>
  );
}
