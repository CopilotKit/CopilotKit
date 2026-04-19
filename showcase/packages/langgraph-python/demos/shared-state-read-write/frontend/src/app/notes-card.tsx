"use client";

import React from "react";

export interface NotesCardProps {
  notes: string[];
  onClear: () => void;
}

/**
 * Sidebar card that READS agent-authored notes out of shared state.
 *
 * The agent writes these via its `set_notes` tool. The UI reflects every
 * update in real time because the parent page subscribes via
 * `useAgent({ updates: [OnStateChanged] })` and passes `state.notes` in.
 *
 * The "Clear" button is a write-back (UI -> agent state) to demonstrate
 * both directions on the same field.
 */
// @region[notes-card-render]
// Read-side render: this card reflects the agent-authored `notes` slice
// of shared state. The parent page passes `state.notes` in; we never
// touch agent state ourselves — we just render it. The Clear button is
// a small write-back, exposed as an `onClear` prop.
export function NotesCard({ notes, onClear }: NotesCardProps) {
  return (
    <div
      data-testid="notes-card"
      className="w-full max-w-md p-6 bg-white rounded-2xl shadow-lg border border-gray-100 space-y-3"
    >
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-800">Agent Notes</h2>
          <p className="text-xs text-gray-500 mt-1">
            The agent writes here via its <code>set_notes</code> tool. The UI
            re-renders from shared state.
          </p>
        </div>
        {notes.length > 0 && (
          <button
            type="button"
            onClick={onClear}
            data-testid="notes-clear-button"
            className="text-xs text-gray-500 hover:text-red-500 border rounded px-2 py-1"
          >
            Clear
          </button>
        )}
      </div>

      {notes.length === 0 ? (
        <div
          data-testid="notes-empty"
          className="text-sm text-gray-400 italic pt-2"
        >
          No notes yet. Ask the agent to remember something.
        </div>
      ) : (
        <ul
          data-testid="notes-list"
          className="list-disc list-inside space-y-1 text-sm text-gray-800"
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
