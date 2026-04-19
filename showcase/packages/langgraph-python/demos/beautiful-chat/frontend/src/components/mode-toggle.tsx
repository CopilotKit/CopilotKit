"use client";

// Light/Dark/System toggle — compact pill in the header.
import { useTheme } from "@/hooks/use-theme";

const OPTIONS = ["light", "dark", "system"] as const;

export function ModeToggle() {
  const { theme, setTheme } = useTheme();

  return (
    <div className="inline-flex rounded-full border border-[var(--border)] bg-[var(--secondary)] p-0.5">
      {OPTIONS.map((t) => (
        <button
          key={t}
          onClick={() => setTheme(t)}
          className={`px-3 py-1 rounded-full text-[11px] font-medium capitalize transition-all cursor-pointer ${
            theme === t
              ? "bg-[var(--card)] text-[var(--card-foreground)] shadow-sm"
              : "text-[var(--muted-foreground)]"
          }`}
        >
          {t}
        </button>
      ))}
    </div>
  );
}
