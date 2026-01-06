import { useState, useEffect } from "react";
import { Sun, Moon, LogOut, User } from "lucide-react";
import { authenticatedFetch } from "~/utils/api";
import { getRefreshToken, clearAuthData, getUserInfo } from "~/utils/storage";
import { useNavigate } from "react-router";
import { API_BASE_URL, API_ENDPOINTS } from "~/config/constants";
import { useToast } from "~/hooks/ToastContext";
import { useTheme } from "~/hooks/ThemeContext";
import { Avatar, AvatarFallback, AvatarImage } from "~/components/ui/avatar";
import { Button } from "~/components/ui/button";
import type { User as UserType } from "~/types";

export default function SidebarUserProfile() {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { theme, toggleTheme } = useTheme();
  const [user, setUser] = useState<UserType | null>(null);

  useEffect(() => {
    const loadUser = async () => {
      const userInfo = await getUserInfo();
      setUser(userInfo);
    };
    loadUser();
  }, []);

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
    showToast("Logged out successfully!", "success");

    setTimeout(() => {
      navigate("/login", { replace: true });
    }, 500);
  };

  // Extract username from email
  const getUsername = () => {
    if (user?.email) return `@${user.email.split("@")[0]}`;
    return "@user";
  };

  return (
    <div className="p-2 border-t border-zinc-200 dark:border-zinc-800">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <Avatar className="h-7 w-7 shrink-0">
            <AvatarImage
              src={user?.avatarUrl}
              alt={user?.name || user?.email}
            />
            <AvatarFallback className="bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200">
              <User className="h-3.5 w-3.5" />
            </AvatarFallback>
          </Avatar>
          <div className="flex flex-col min-w-0 flex-1">
            <p className="text-xs font-medium text-zinc-900 dark:text-zinc-200 truncate">
              {user?.name || "User"}
            </p>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 truncate">
              {getUsername()}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleTheme}
            className="h-7 w-7"
            title={theme === "light" ? "Dark mode" : "Light mode"}
          >
            {theme === "light" ? (
              <Moon className="h-3.5 w-3.5" strokeWidth={1.5} />
            ) : (
              <Sun className="h-3.5 w-3.5" strokeWidth={1.5} />
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={onLogout}
            className="h-7 w-7 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/50"
            title="Logout"
          >
            <LogOut className="h-3.5 w-3.5" strokeWidth={1.5} />
          </Button>
        </div>
      </div>
    </div>
  );
}
