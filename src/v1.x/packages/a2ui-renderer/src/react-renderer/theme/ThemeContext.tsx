import { createContext, useContext, type ReactNode } from 'react';
import type { Types } from '@a2ui/lit/0.8';
import { defaultTheme } from './litTheme';

/**
 * React context for the A2UI theme.
 */
const ThemeContext = createContext<Types.Theme | undefined>(undefined);

/**
 * Props for the ThemeProvider component.
 */
export interface ThemeProviderProps {
  /** The theme to provide. Falls back to defaultTheme if not specified. */
  theme?: Types.Theme;
  /** Child components that will have access to the theme */
  children: ReactNode;
}

/**
 * Provider component that makes the A2UI theme available to descendant components.
 */
export function ThemeProvider({ theme, children }: ThemeProviderProps) {
  return (
    <ThemeContext.Provider value={theme ?? defaultTheme}>
      {children}
    </ThemeContext.Provider>
  );
}

/**
 * Hook to access the current A2UI theme.
 *
 * @returns The current theme
 * @throws If used outside of a ThemeProvider
 */
export function useTheme(): Types.Theme {
  const theme = useContext(ThemeContext);
  if (!theme) {
    throw new Error('useTheme must be used within a ThemeProvider or A2UIProvider');
  }
  return theme;
}

/**
 * Hook to optionally access the current A2UI theme.
 *
 * @returns The current theme, or undefined if not within a provider
 */
export function useThemeOptional(): Types.Theme | undefined {
  return useContext(ThemeContext);
}
