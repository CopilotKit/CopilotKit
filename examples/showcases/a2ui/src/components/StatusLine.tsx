import { useEffect } from "react";
import { useDesk } from "../lib/desk-store";

/**
 * One quiet line at the foot of the chat that confirms what a generated
 * button did, with an action (Undo) when there is one. It stays while the
 * reader hovers or focuses it; Cmd/Ctrl+Z runs the action.
 */
export function StatusLine() {
  const { status, holdStatus } = useDesk();
  const action = status?.action;

  // Cmd/Ctrl+Z runs the action (Undo) while it is on screen.
  useEffect(() => {
    if (!action) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        const target = event.target as HTMLElement | null;
        if (target?.closest("input, textarea, [contenteditable]")) return;
        event.preventDefault();
        action.run();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [action]);

  return (
    <div className="status" role="status" aria-live="polite">
      {status && (
        <p
          key={status.id}
          className="status__toast"
          onMouseEnter={() => holdStatus(true)}
          onMouseLeave={() => holdStatus(false)}
          onFocus={() => holdStatus(true)}
          onBlur={() => holdStatus(false)}
        >
          {status.text}
          {status.action && (
            <button
              type="button"
              className="status__action"
              onClick={status.action.run}
            >
              {status.action.label}
            </button>
          )}
        </p>
      )}
    </div>
  );
}
