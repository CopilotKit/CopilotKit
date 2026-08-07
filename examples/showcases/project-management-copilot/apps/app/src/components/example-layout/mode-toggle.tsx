interface ModeToggleProps {
  mode: "chat" | "app";
  onModeChange: (mode: "chat" | "app") => void;
}

/**
 * Top-right glass pill toggle. Active tab gets a white background — same
 * pattern as the dojo view-toggle tabs.
 */
export function ModeToggle({ mode, onModeChange }: ModeToggleProps) {
  return (
    <div
      // `.layout` (threads-drawer.module.css) wraps the page in `padding: 8px`,
      // so a `top-4 right-4` (16px) fixed offset only buys 8px of clearance
      // inside the glass panel border and reads as flush-to-corner. Bump to
      // top-6 right-6 (24px) on the desktop layout (= 16px clear inside the
      // panel); mobile keeps a tighter offset to match the smaller panel
      // margin and the existing scale-90.
      className="fixed top-6 right-6 z-50 flex max-lg:top-3 max-lg:right-3 max-lg:scale-90"
      style={{
        background: "rgba(255, 255, 255, 0.5)",
        border: "2px solid #ffffff",
        borderRadius: 8,
        padding: 2,
        gap: 2,
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
      }}
    >
      {(["chat", "app"] as const).map((m) => {
        const active = mode === m;
        return (
          <button
            key={m}
            onClick={() => onModeChange(m)}
            style={{
              height: 28,
              padding: "0 12px",
              border: 0,
              borderRadius: 6,
              background: active ? "#ffffff" : "transparent",
              color: active ? "var(--text-primary)" : "var(--text-secondary)",
              fontFamily: "var(--font-body)",
              fontSize: 13,
              fontWeight: 500,
              cursor: "pointer",
              transition: "background 140ms ease, color 140ms ease",
            }}
          >
            {m === "chat" ? "Chat" : "Board"}
          </button>
        );
      })}
    </div>
  );
}
