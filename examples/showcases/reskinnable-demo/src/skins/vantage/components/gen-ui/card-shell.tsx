"use client";

import type { ReactNode } from "react";

/**
 * Shared chrome for gen-UI cards in the chat transcript. `pointer-events-auto`
 * because CopilotKit paints `useComponent` renders with pointer-events: none on
 * the assistant message — any card with a link or control needs its subtree
 * opted back in, or the control renders and cannot be clicked.
 */
export function CardShell({
  title,
  note,
  loading,
  children,
}: {
  title: string;
  note?: string;
  loading?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="pointer-events-auto space-y-3 rounded-[var(--radius)] border border-hairline bg-surface p-4 text-ink">
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      {loading ? (
        <div className="text-xs text-ink-muted">Reading the ledger…</div>
      ) : (
        children
      )}
      {note && <p className="text-[11px] text-ink-muted">{note}</p>}
    </div>
  );
}
