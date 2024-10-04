import React, { createContext, useState, useEffect, useContext } from 'react';
import { useTheme as useNextThemes } from 'next-themes'

type Theme = 'light' | 'dark';

interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { theme: nextTheme, setTheme: setNextTheme } = useNextThemes()
  const [theme, setTheme] = useState<Theme>('light');

  useEffect(() => {
    setTheme(nextTheme as Theme);
  }, [nextTheme]);

  const toggleTheme = () => {
    const newTheme = theme === 'light' ? 'dark' : 'light';
    setNextTheme(newTheme);
  };

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};