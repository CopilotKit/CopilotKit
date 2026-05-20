"use client";

import React from "react";

export interface NotesCardProps {
  notes: string[];
  onClear: () => void;
}

/**
 * Sidebar card that reads agent-authored notes out of shared state.
 *
 * The Spring agent writes these via its `set_notes` tool (which mutates
 * shared state and emits a STATE_SNAPSHOT event). The UI reflects every
 * update in real time because the parent page subscribes via
 * `useAgent({ updates: [OnStateChanged] })` and passes `state.notes` in.
 *
 * The "Clear" button is a write-back (UI -> agent state) to demonstrate
 * both directions on the same field.
 */
// @region[notes-card-render]
export function NotesCard({ notes, onClear }: NotesCardProps) {
  return (
    <div
      data-testid="notes-card"
      className="w-full max-w-md p-6 bg-white rounded-2xl shadow-sm border border-[#DBDBE5] space-y-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-[#010507]">Agent notes</h2>
          <p className="text-xs text-[#57575B] mt-1">
            The Spring agent writes here via its{" "}
            <code className="font-mono text-[11px] text-[#010507]">
              set_notes
            </code>{" "}
            tool. The UI re-renders from shared state.
          </p>
        </div>
        {notes.length > 0 && (
          <button
            type="button"
            onClick={onClear}
            data-testid="notes-clear-button"
            className="text-[10px] uppercase tracking-[0.14em] font-medium text-[#57575B] hover:text-[#FA5F67] border border-[#DBDBE5] hover:border-[#FA5F67] rounded-full px-2.5 py-1 transition-colors"
          >
            Clear
          </button>
        )}
      </div>

      {notes.length === 0 ? (
        <div
          data-testid="notes-empty"
          className="text-sm text-[#838389] italic pt-1"
        >
          No notes yet. Ask the agent to remember something.
        </div>
      ) : (
        <ul
          data-testid="notes-list"
          className="list-disc list-inside space-y-1 text-sm text-[#010507]"
        >
          {notes.map((note, i) => (
            <li key={i} data-testid="note-item">
              {note}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
// @endregion[notes-card-render]
