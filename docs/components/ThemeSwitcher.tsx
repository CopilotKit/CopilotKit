import { useState, useEffect } from 'react';
import { useTheme } from 'next-themes';

const ThemeSwitcher = () => {
  const { theme, setTheme } = useTheme();
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);

  return (
    <button
      onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
      className="theme-switcher"
    >
      {isClient ? (
        theme === 'light' ? '🌙' : '☀️'
      ) : (
        '🌙' // or '☀️', depending on default server-side theme, used to solve Error: Hydration failed because the initial UI does not match what was rendered on the server.
      )}
    </button>
  );
};

export default ThemeSwitcher;