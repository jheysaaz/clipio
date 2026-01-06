import { Mail, Lock, Loader2 } from "lucide-react";
import { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router";
import { useToast } from "~/hooks/ToastContext";
import { saveAuthData } from "~/utils/storage";
import { logger } from "~/utils/logger";
import type { LoginResponse } from "~/types";
import { API_BASE_URL, API_ENDPOINTS } from "~/config/constants";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";

type ToastState = {
  message?: string;
  type?: "success" | "error";
} | null;

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const { showToast } = useToast();
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [loadingLogin, setLoadingLogin] = useState(false);

  useEffect(() => {
    const state = (location.state as ToastState) || null;
    if (state?.message) {
      showToast(state.message, state.type ?? "success");
      navigate(location.pathname, { replace: true, state: null });
    }
  }, [location, navigate, showToast]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    setLoadingLogin(true);
    try {
      const res = await fetch(API_BASE_URL + API_ENDPOINTS.LOGIN, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ login, password }),
      });

      const data: LoginResponse = await res.json();
      setLoadingLogin(false);

      if (res.status === 200) {
        const expiresIn = data.expiresIn;

        // Save auth data and navigate in parallel
        await Promise.all([
          saveAuthData(data.accessToken, data.user, expiresIn),
          (async () => {
            if (typeof localStorage !== "undefined") {
              localStorage.setItem("storageType", "cloud");
            }
          })(),
        ]);

        logger.success("Login successful", {
          data: { user: data.user.email, userId: data.user.id },
          timestamp: true,
        });

        navigate("/dashboard", { replace: true });
      } else {
        showToast(
          (data as any).error || "Login failed. Please try again.",
          "error"
        );
      }
    } catch (error) {
      logger.error("Login failed", { data: { error } });
      setLoadingLogin(false);
      showToast("Network error. Please check your connection.", "error");
    }
  };

  return (
    <div className="flex flex-col h-full p-6">
      <div className="flex-1 flex flex-col justify-center">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-semibold mb-2">Sign In</h1>
          <p className="text-zinc-600 dark:text-zinc-400">
            Sync your snippets across all devices
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 mb-6">
          <div className="space-y-2">
            <Label htmlFor="login">Email or Username</Label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400 dark:text-zinc-500" />
              <Input
                id="login"
                type="text"
                value={login}
                onChange={(e) => setLogin(e.target.value)}
                placeholder="your@email.com or username"
                required
                className="pl-10"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400 dark:text-zinc-500" />
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                className="pl-10"
              />
            </div>
          </div>

          <Button type="submit" className="w-full" disabled={loadingLogin}>
            {loadingLogin ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Signing In...
              </>
            ) : (
              "Sign In"
            )}
          </Button>
        </form>

        <p className="text-xs text-center text-zinc-500 dark:text-zinc-500 mt-6">
          Don't have an account?{" "}
          <Button
            variant="link"
            className="p-0 h-auto text-xs font-medium"
            onClick={() => navigate("/sign-up")}
          >
            Sign up
          </Button>
        </p>
      </div>
    </div>
  );
}
