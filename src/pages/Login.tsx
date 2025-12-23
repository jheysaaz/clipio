import { Mail, Lock } from "lucide-react";
import { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router";
import { useAppDispatch } from "../store/hooks";
import { showToast } from "../store/slices/toastSlice";
import {
  saveAuthData,
  saveCachedSnippets,
  saveLastSyncMeta,
} from "../utils/storage";
import { logger } from "../utils/logger";
import type { LoginResponse } from "../types";
import { API_BASE_URL, API_ENDPOINTS } from "../config/constants";
import { fetchWithTimeout } from "../utils/security";

type ToastState = {
  message?: string;
  type?: "success" | "error";
} | null;

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const dispatch = useAppDispatch();
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [loadingLogin, setLoadingLogin] = useState(false);

  useEffect(() => {
    const state = (location.state as ToastState) || null;
    if (state?.message) {
      dispatch(
        showToast({ message: state.message, type: state.type ?? "success" })
      );
      navigate(location.pathname, { replace: true, state: null });
    }
  }, [location, navigate, dispatch]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    setLoadingLogin(true);
    try {
      const res = await fetchWithTimeout(API_BASE_URL + API_ENDPOINTS.LOGIN, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include", // needed to receive httpOnly refresh cookie
        body: JSON.stringify({ login, password }),
      });

      let data: LoginResponse | undefined;

      // Only parse JSON if response is valid
      if (res.ok) {
        try {
          data = (await res.json()) as LoginResponse;
        } catch (parseError) {
          console.error("Failed to parse login response:", parseError);
          dispatch(
            showToast({
              message: "Login failed. Invalid server response.",
              type: "error",
            })
          );
          setLoadingLogin(false);
          return;
        }
      } else {
        // For error responses, try to parse error message
        try {
          data = (await res.json()) as LoginResponse;
        } catch {
          // If we can't parse error response, use generic message
          data = undefined;
        }
      }

      setLoadingLogin(false);

      if (res.status === 200 && data) {
        const expiresIn = data.expiresIn;
        await saveAuthData(data.accessToken, data.user, expiresIn);

        // Kick off initial sync to hydrate cache after login
        void (async () => {
          try {
            const since = "1970-01-01T00:00:00Z";
            const syncRes = await fetchWithTimeout(
              `${API_BASE_URL + API_ENDPOINTS.SNIPPETS_SYNC}?updated_since=${encodeURIComponent(
                since
              )}`,
              {
                method: "GET",
                headers: {
                  Authorization: `Bearer ${data.accessToken}`,
                },
              }
            );

            if (syncRes.ok) {
              const syncData = await syncRes.json();
              const items = syncData.items || syncData.snippets || syncData;
              await saveCachedSnippets(data.user.id, items || []);
              await saveLastSyncMeta(data.user.id, new Date().toISOString());
              logger.success("Initial sync completed after login");
            } else {
              logger.warn("Initial sync failed after login", {
                data: { status: syncRes.status },
              });
            }
          } catch (syncError) {
            logger.error("Initial sync error after login", {
              data: { error: syncError },
            });
          }
        })();

        if (typeof localStorage !== "undefined") {
          localStorage.setItem("storageType", "cloud");
        }

        logger.success("Login successful", {
          data: { user: data.user.email, userId: data.user.id },
          timestamp: true,
        });
        navigate("/dashboard", { replace: true });
      } else {
        // Generic error message - don't expose server error directly
        const errorMsg =
          data && "error" in data && typeof data.error === "string"
            ? data.error
            : "Login failed. Please check your credentials and try again.";
        dispatch(
          showToast({
            message: errorMsg,
            type: "error",
          })
        );
      }
    } catch (error) {
      logger.error("Login failed", { data: { error } });
      setLoadingLogin(false);
      dispatch(
        showToast({
          message: "Network error. Please check your connection.",
          type: "error",
        })
      );
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
          <div>
            <label
              htmlFor="login"
              className="block text-sm font-medium mb-2 text-zinc-700 dark:text-zinc-300"
            >
              Email or Username
            </label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400 dark:text-zinc-500" />
              <input
                id="login"
                type="text"
                value={login}
                onChange={(e) => setLogin(e.target.value)}
                placeholder="your@email.com or username"
                required
                className="w-full pl-10 pr-4 py-2.5 border border-zinc-200 dark:border-zinc-800 rounded-lg bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-50 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-gray-400 dark:focus:ring-gray-600"
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="password"
              className="block text-sm font-medium mb-2 text-zinc-700 dark:text-zinc-300"
            >
              Password
            </label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400 dark:text-zinc-500" />
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                className="w-full pl-10 pr-4 py-2.5 border border-zinc-200 dark:border-zinc-800 rounded-lg bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-50 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-gray-400 dark:focus:ring-gray-600"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loadingLogin}
            className={`w-full py-2.5 font-medium rounded-lg transition-colors ${
              loadingLogin
                ? "bg-gray-400 text-white cursor-not-allowed"
                : "bg-gray-900 hover:bg-gray-800 dark:bg-white dark:hover:bg-gray-100 text-white dark:text-gray-900"
            }`}
          >
            {loadingLogin ? (
              <div className="flex items-center justify-center gap-2">
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                Signing In...
              </div>
            ) : (
              "Sign In"
            )}
          </button>
        </form>

        <p className="text-xs text-center text-zinc-500 dark:text-zinc-500 mt-6">
          Don't have an account?{" "}
          <button
            onClick={() => navigate("/sign-up")}
            className="text-gray-700 dark:text-gray-300 hover:underline font-medium"
          >
            Sign up
          </button>
        </p>
      </div>
    </div>
  );
}
