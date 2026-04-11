import { createContext, useContext, type ReactNode } from "react";

type ThemeType = Record<string, unknown>;

/** React context for the A2UI theme. */
const ThemeContext = createContext<ThemeType | undefined>(undefined);

export interface ThemeProviderProps {
  theme?: ThemeType;
  children: ReactNode;
}

export function ThemeProvider({ theme, children }: ThemeProviderProps) {
  return (
    <ThemeContext.Provider value={theme ?? {}}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeType {
  const theme = useContext(ThemeContext);
  if (!theme) {
    throw new Error(
      "useTheme must be used within a ThemeProvider or A2UIProvider",
    );
  }
  return theme;
}

export function useThemeOptional(): ThemeType | undefined {
  return useContext(ThemeContext);
}
