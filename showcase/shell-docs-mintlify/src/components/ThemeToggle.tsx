import { useEffect, useState } from "react";
import { Icon, cn } from "@mintlify/components";

type Theme = "light" | "dark";

const STORAGE_KEY = "theme";

/**
 * Read the active theme from the `<html>` element. The init script in
 * Layout.astro applies `.dark` synchronously before the body renders, so
 * by the time React mounts the class is already authoritative.
 */
function readTheme(): Theme {
  if (typeof document === "undefined") return "light";
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

function applyTheme(next: Theme): void {
  const root = document.documentElement;
  if (next === "dark") {
    root.classList.add("dark");
  } else {
    root.classList.remove("dark");
  }
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // localStorage may be unavailable (private browsing, ITP).
  }
}

interface ThemeToggleProps {
  className?: string;
}

export function ThemeToggle({ className }: ThemeToggleProps) {
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    setTheme(readTheme());

    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return;
      const next: Theme = e.newValue === "dark" ? "dark" : "light";
      const root = document.documentElement;
      if (next === "dark") root.classList.add("dark");
      else root.classList.remove("dark");
      setTheme(next);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const handleClick = () => {
    // Read the actual active theme from the DOM rather than React state —
    // state may be `null` for one render after Astro view-transition remounts.
    const current: Theme = readTheme();
    const next: Theme = current === "dark" ? "light" : "dark";
    applyTheme(next);
    setTheme(next);
  };

  const isDark = theme === "dark";
  const label = isDark ? "Switch to light mode" : "Switch to dark mode";

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={label}
      title={label}
      className={cn(
        "flex items-center justify-center w-9 h-9 rounded-[0.85rem] text-gray-500 hover:text-gray-800 hover:bg-gray-100 dark:text-gray-400 dark:hover:text-gray-100 dark:hover:bg-gray-800 transition-colors",
        className,
      )}
    >
      {/* Render both icons; CSS swaps which one shows based on `.dark` on
       * <html>. This keeps the button width stable and avoids a flash before
       * the mount effect populates `theme`. */}
      <span className="block dark:hidden">
        <Icon icon="sun" iconLibrary="lucide" size={18} color="currentColor" />
      </span>
      <span className="hidden dark:block">
        <Icon icon="moon" iconLibrary="lucide" size={18} color="currentColor" />
      </span>
    </button>
  );
}

export default ThemeToggle;
