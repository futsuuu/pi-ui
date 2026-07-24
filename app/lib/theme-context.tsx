import { createContext, useContext, useState, useLayoutEffect, type ReactNode } from "react";

type Theme = "light" | "dark";

interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextType>({
  theme: "dark",
  toggleTheme: () => {},
  setTheme: () => {},
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("dark");

  // On mount, read saved preference and apply it
  useLayoutEffect(() => {
    const stored = localStorage.getItem("theme") as Theme | null;
    const resolved: Theme = stored === "light" || stored === "dark" ? stored : "dark";
    setThemeState(resolved);
    applyTheme(resolved);
  }, []);

  function applyTheme(t: Theme) {
    // Overwrite the class list instead of toggling, so no other code
    // can interfere.  The inline <script> in root.tsx sets the initial
    // class before React hydrates; this keeps it in sync afterwards.
    document.documentElement.className = t === "dark" ? "dark" : "";
  }

  const setTheme = (t: Theme) => {
    setThemeState(t);
    localStorage.setItem("theme", t);
    applyTheme(t);
  };

  const toggleTheme = () => {
    setTheme(theme === "dark" ? "light" : "dark");
  };

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
