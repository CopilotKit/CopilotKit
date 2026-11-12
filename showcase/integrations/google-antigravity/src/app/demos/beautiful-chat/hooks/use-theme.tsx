"use client";

import { createContext, useContext, useSyncExternalStore } from "react";

type Theme = "dark" | "light";

// The page theme belongs to the root layout's theme bootstrap
// (`window.__copilotkitTheme`), which also follows the embedding page and the
// system preference. Reading and setting it there keeps one source of truth.
const subscribe = (onChange: () => void) =>
  window.__copilotkitTheme?.subscribe(onChange) ?? (() => {});
const getTheme = (): Theme => window.__copilotkitTheme?.get() ?? "light";
const setTheme = (theme: Theme) => window.__copilotkitTheme?.set(theme);

const ThemeContext = createContext<{
  theme: Theme;
  setTheme: (t: Theme) => void;
}>({
  theme: "light",
  setTheme,
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = useSyncExternalStore(subscribe, getTheme, (): Theme => "light");

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
