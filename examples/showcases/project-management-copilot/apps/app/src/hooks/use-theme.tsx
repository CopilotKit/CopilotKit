"use client";

import { createContext, useContext, useEffect, useState } from "react";

/**
 * The CopilotKit demo uses a single light (lavender) palette. The
 * `toggleTheme` frontend tool flips between two glass-density variants:
 *
 *   "light"     → translucent white (rgba(255,255,255,0.5)) on lavender
 *   "frosted"   → denser glass (.dark class swaps a few tokens)
 *
 * We keep the type name "Theme" + class names ("light" / "dark") so
 * existing components and the CSS dark variant keep working.
 */
type Theme = "light" | "dark";

const ThemeContext = createContext<{
  theme: Theme;
  setTheme: (t: Theme) => void;
}>({
  theme: "light",
  setTheme: () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove("light", "dark");
    root.classList.add(theme);
  }, [theme]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
