import { Code2, Sun, Moon, Power } from "lucide-react";
import { authenticatedFetch } from "../utils/api";
import { getRefreshToken, clearAuthData } from "../utils/storage";
import { useNavigate } from "react-router";
import { API_BASE_URL, API_ENDPOINTS } from "../config/constants";
import { useAppDispatch, useAppSelector } from "../store/hooks";
import { toggleTheme } from "../store/slices/themeSlice";
import { showToast } from "../store/slices/toastSlice";
import { logger } from "../utils/logger";

export default function Header() {
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const theme = useAppSelector((state) => state.theme.current);

  const onLogout = async () => {
    try {
      const refreshToken = await getRefreshToken();
      if (refreshToken) {
        await authenticatedFetch(API_BASE_URL + API_ENDPOINTS.LOGOUT, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ refreshToken }),
        });
      }
    } catch (error) {
      console.error("Logout API error (ignored):", error);
    }

    clearAuthData();
    dispatch(
      showToast({ message: "Logged out successfully!", type: "success" })
    );

    setTimeout(() => {
      navigate("/login", { replace: true });
    }, 500);
  };

  return (
    <header className="flex flex-row transition-colors">
      <div className="flex w-full justify-between items-start">
        <div className="mb-3">
          <div className="flex items-center gap-2 mb-1">
            <div className="p-1.5 bg-gray-500/10 dark:bg-gray-500/20 rounded-lg">
              <Code2 className="h-4 w-4 text-gray-700 dark:text-gray-300 " />
            </div>
            <h1 className="text-zinc-900 dark:text-zinc-50">
              Snippy Dashboard
            </h1>
          </div>
          <p className="text-zinc-600 dark:text-zinc-400">
            Store and manage your super snippets
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => dispatch(toggleTheme())}
            className="p-2 rounded-lg bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
            aria-label="Toggle theme"
          >
            {theme === "light" ? (
              <Moon className="h-4 w-4 text-zinc-700 dark:text-zinc-300" />
            ) : (
              <Sun className="h-4 w-4 text-zinc-700 dark:text-zinc-300" />
            )}
          </button>
          <button
            onClick={onLogout}
            className="p-2 rounded-lg bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
            aria-label="Logout"
          >
            <Power className="h-4 w-4 text-zinc-700 dark:text-zinc-300 hover:text-red-500" />
          </button>
        </div>
      </div>
    </header>
  );
}
