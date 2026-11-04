interface ModeToggleProps {
  mode: "chat" | "app";
  onModeChange: (mode: "chat" | "app") => void;
}

export function ModeToggle({ mode, onModeChange }: ModeToggleProps) {
  return (
    <div className="fixed top-4 right-4 z-50 flex bg-gray-100 dark:bg-zinc-800 rounded-lg p-1 shadow-sm max-lg:top-2 max-lg:right-2 max-lg:scale-90">
      <button
        onClick={() => onModeChange("chat")}
        className={`
          px-4 py-2 rounded-md text-sm font-medium transition-all max-lg:px-3 max-lg:py-1.5 max-lg:text-xs
          cursor-pointer
          ${
            mode === "chat"
              ? "bg-white dark:bg-zinc-700 text-gray-900 dark:text-white shadow-sm"
              : "text-gray-600 dark:text-zinc-400 hover:text-gray-900 dark:hover:text-white"
          }
        `}
      >
        Chat
      </button>
      <button
        onClick={() => onModeChange("app")}
        className={`
          px-4 py-2 rounded-md text-sm font-medium transition-all max-lg:px-3 max-lg:py-1.5 max-lg:text-xs
          cursor-pointer
          ${
            mode === "app"
              ? "bg-white dark:bg-zinc-700 text-gray-900 dark:text-white shadow-sm"
              : "text-gray-600 dark:text-zinc-400 hover:text-gray-900 dark:hover:text-white"
          }
        `}
      >
        App Mode
      </button>
    </div>
  );
}
