import * as React from "react";

interface ThemeState {
  mode: "light" | "dark";
}

const ThemeContext = React.createContext<ThemeState>({ mode: "light" });

export function ThemeProvider({
  mode,
  children,
}: {
  mode: "light" | "dark";
  children: React.ReactNode;
}) {
  return (
    <ThemeContext.Provider value={{ mode }}>{children}</ThemeContext.Provider>
  );
}

export function useTheme() {
  return React.useContext(ThemeContext);
}
