import { createSlice, PayloadAction } from "@reduxjs/toolkit";

export type Theme = "light" | "dark";

interface ThemeState {
  current: Theme;
}

// Helper to apply theme to DOM
const applyThemeToDOM = (theme: Theme) => {
  const root = document.documentElement;
  if (theme === "dark") {
    root.classList.add("dark");
  } else {
    root.classList.remove("dark");
  }
  localStorage.setItem("theme", theme);
};

// Get initial theme from localStorage or system preference
const getInitialTheme = (): Theme => {
  const savedTheme = localStorage.getItem("theme") as Theme | null;
  if (savedTheme) return savedTheme;

  const systemTheme = window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
  return systemTheme;
};

const initialState: ThemeState = {
  current: getInitialTheme(),
};

// Apply initial theme to DOM
applyThemeToDOM(initialState.current);

const themeSlice = createSlice({
  name: "theme",
  initialState,
  reducers: {
    setTheme: (state, action: PayloadAction<Theme>) => {
      state.current = action.payload;
      applyThemeToDOM(action.payload);
    },
    toggleTheme: (state) => {
      const newTheme = state.current === "light" ? "dark" : "light";
      state.current = newTheme;
      applyThemeToDOM(newTheme);
    },
  },
});

export const { setTheme, toggleTheme } = themeSlice.actions;
export default themeSlice.reducer;
