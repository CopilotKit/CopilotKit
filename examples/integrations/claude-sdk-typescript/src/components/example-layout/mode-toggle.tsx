interface ModeToggleProps {
  mode: "chat" | "app";
  onModeChange: (mode: "chat" | "app") => void;
}

export function ModeToggle({ mode, onModeChange }: ModeToggleProps) {
  return (
    <div
      role="group"
      aria-label="View mode"
      className="fixed top-4 right-4 z-50 flex items-center min-h-[46px] rounded-[4px] border border-[var(--border)] bg-[var(--secondary)] p-1.5"
    >
      <button
        type="button"
        aria-pressed={mode === "chat"}
        onClick={() => onModeChange("chat")}
        className={`px-4 py-1.5 rounded-[2px] text-[13px] leading-[20px] font-medium transition-all cursor-pointer ${
          mode === "chat"
            ? "bg-[var(--card)] text-[var(--card-foreground)] shadow-sm"
            : "text-[var(--muted-foreground)]"
        }`}
      >
        Chat
      </button>
      <button
        type="button"
        aria-pressed={mode === "app"}
        onClick={() => onModeChange("app")}
        className={`px-4 py-1.5 rounded-[2px] text-[13px] leading-[20px] font-medium transition-all cursor-pointer ${
          mode === "app"
            ? "bg-[var(--card)] text-[var(--card-foreground)] shadow-sm"
            : "text-[var(--muted-foreground)]"
        }`}
      >
        App
      </button>
    </div>
  );
}
