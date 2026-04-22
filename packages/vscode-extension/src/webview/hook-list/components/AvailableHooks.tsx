import React, { useState } from "react";
import type { HookDef } from "../../../extension/hooks/hook-registry";

interface Props {
  available: HookDef[];
}

/**
 * Dimmed chip list of hook types that are registered in HOOK_REGISTRY but
 * have zero call sites in the workspace. Hidden by default — toggled via
 * "Show available hooks" so it doesn't clutter the main view.
 */
export function AvailableHooks({ available }: Props) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="mt-2 pt-2 border-t border-[var(--vscode-panel-border)]">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-1 px-3 py-1 text-left hover:bg-[var(--vscode-list-hoverBackground)] focus:outline-none focus:ring-1 focus:ring-[var(--vscode-focusBorder)]"
      >
        <span className="inline-block w-3 text-[10px] text-[var(--vscode-descriptionForeground)]">
          {expanded ? "\u25BE" : "\u25B8"}
        </span>
        <span className="text-[11px] uppercase tracking-wider text-[var(--vscode-descriptionForeground)]">
          Available hooks
        </span>
        <span className="ml-1 text-[11px] text-[var(--vscode-descriptionForeground)]">
          ({available.length})
        </span>
      </button>
      {expanded && (
        <div className="px-3 py-2 flex flex-wrap gap-1.5">
          {available.map((def) => (
            <span
              key={def.name}
              title={`${def.category} hook from ${def.importSource}`}
              className="inline-flex items-center text-[11px] px-1.5 py-0.5 rounded border border-[var(--vscode-panel-border)] text-[var(--vscode-descriptionForeground)] opacity-70"
            >
              {def.name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
