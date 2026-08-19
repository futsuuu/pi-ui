import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useState,
  type ReactNode,
} from "react";

export type Theme = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

interface ThemeContextType {
  theme: Theme;
  /** The effective theme after resolving "system" against the OS preference. */
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextType>({
  theme: "system",
  resolvedTheme: "dark",
  setTheme: () => {},
});

export function useTheme() {
  return useContext(ThemeContext);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("system");
  const [systemDark, setSystemDark] = useState(false);

  // On mount, read the saved preference and subscribe to the OS color scheme
  // so a "system" theme tracks changes while the app is open.
  useLayoutEffect(() => {
    // Storage access is best effort: some environments (e.g. private browsing)
    // throw on access, so fall back to the system default when it fails.
    let stored: string | null = null;
    try {
      stored = localStorage.getItem("theme");
    } catch {
      // No stored preference; stay on the "system" default.
    }
    // Only explicit light/dark choices are honored; anything else (a saved
    // "system" or an unknown value) stays on the "system" default.
    if (stored === "light" || stored === "dark") {
      setThemeState(stored);
    }
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const onSystemChange = () => setSystemDark(mql.matches);
    onSystemChange();
    mql.addEventListener("change", onSystemChange);
    return () => mql.removeEventListener("change", onSystemChange);
  }, []);

  const resolvedTheme: ResolvedTheme = theme === "system" ? (systemDark ? "dark" : "light") : theme;

  // Apply the resolved theme to the document. Overwrite the class list
  // instead of toggling, so no other code can interfere. The inline <script>
  // in root.tsx sets the initial class before React hydrates; this keeps it
  // in sync afterwards.
  useLayoutEffect(() => {
    document.documentElement.className = resolvedTheme === "dark" ? "dark" : "";
  }, [resolvedTheme]);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    try {
      localStorage.setItem("theme", t);
    } catch {
      // Persistence is best effort; the in-memory selection still applies.
    }
  }, []);

  return <ThemeContext value={{ theme, resolvedTheme, setTheme }}>{children}</ThemeContext>;
}

export function ThemeScript() {
  return (
    <script
      dangerouslySetInnerHTML={{
        __html: `(function(){try{var t=localStorage.getItem('theme');var dark=t==='dark'||(t!=='light'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.className=dark?'dark':''}catch(e){}})()`,
      }}
    />
  );
}
