import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  ReactNode,
} from "react";
import { captureError } from "~/lib/sentry";
import {
  themeModeItem,
  legacyThemeItem,
  type ThemeMode,
} from "~/storage/items";

export type { ThemeMode };
type ResolvedTheme = "light" | "dark";

interface ThemeContextType {
  /** The user-selected mode: "light", "dark", or "system". */
  themeMode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => void;
  /** The actually applied theme ("light" or "dark"), resolving "system" from OS. */
  theme: ResolvedTheme;
  /** Toggles between light and dark (ignores system mode). Kept for backward compat. */
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

function getSystemTheme(): ResolvedTheme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themeMode, setThemeModeState] = useState<ThemeMode>("system");
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>("light");
  const [isLoaded, setIsLoaded] = useState(false);

  // Load persisted mode on mount
  useEffect(() => {
    const loadTheme = async () => {
      try {
        const saved = await themeModeItem.getValue();
        if (saved === "light" || saved === "dark" || saved === "system") {
          setThemeModeState(saved);
        } else {
          // Legacy: check old "theme" key
          const legacy = await legacyThemeItem.getValue();
          if (legacy === "light" || legacy === "dark") {
            setThemeModeState(legacy as ThemeMode);
          } else {
            setThemeModeState("system");
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

  // Resolve and apply theme whenever mode changes or system pref changes
  useEffect(() => {
    if (!isLoaded) return;

    const apply = (mode: ThemeMode) => {
      const resolved = mode === "system" ? getSystemTheme() : mode;
      setResolvedTheme(resolved);
      document.documentElement.classList.toggle("dark", resolved === "dark");
    };

    apply(themeMode);

    // Listen to OS preference changes when in system mode
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onSystemChange = () => {
      if (themeMode === "system") apply("system");
    };
    mq.addEventListener("change", onSystemChange);
    return () => mq.removeEventListener("change", onSystemChange);
  }, [themeMode, isLoaded]);

  // Persist mode to storage
  useEffect(() => {
    if (!isLoaded) return;
    themeModeItem.setValue(themeMode).catch(console.warn);
  }, [themeMode, isLoaded]);

  const setThemeMode = (mode: ThemeMode) => {
    setThemeModeState(mode);
  };

  const toggleTheme = () => {
    // Toggle between explicit light/dark, exiting system mode if active
    setThemeModeState((prev) => {
      const current = prev === "system" ? getSystemTheme() : prev;
      return current === "light" ? "dark" : "light";
    });
  };

  return (
    <ThemeContext.Provider
      value={{ themeMode, setThemeMode, theme: resolvedTheme, toggleTheme }}
    >
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
