import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  ReactNode,
} from "react";
import { captureError } from "~/lib/sentry";

type Theme = "light" | "dark";

interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>("light");
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    // Load theme from browser.storage on mount
    const loadTheme = async () => {
      try {
        if (typeof browser !== "undefined" && browser.storage?.local) {
          const result = await browser.storage.local.get("theme");
          if (result.theme) {
            setTheme(result.theme as Theme);
          } else {
            // Check system preference
            const systemTheme = window.matchMedia(
              "(prefers-color-scheme: dark)"
            ).matches
              ? "dark"
              : "light";
            setTheme(systemTheme);
          }
        }
      } catch (error) {
        console.error("Error loading theme:", error);
        captureError(error, { action: "loadTheme" });
      } finally {
        setIsLoaded(true);
      }
    };
    loadTheme();
  }, []);

  useEffect(() => {
    if (!isLoaded) return;

    // Apply theme to document
    document.documentElement.classList.toggle("dark", theme === "dark");

    // Save to browser.storage
    if (typeof browser !== "undefined" && browser.storage?.local) {
      browser.storage.local.set({ theme });
    }
  }, [theme, isLoaded]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === "light" ? "dark" : "light"));
  };

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}
