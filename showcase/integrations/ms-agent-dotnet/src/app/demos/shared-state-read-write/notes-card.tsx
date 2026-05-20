"use client";

import React from "react";

// @region[notes-card-render]
// Read-side render: this card reflects the agent-authored `notes` slice
// of shared state. The parent page passes `state.notes` in; we never
// touch agent state ourselves — we just render it. The Clear button is
// a small write-back, exposed as an `onClear` prop.
export function NotesCard({
  notes,
  onClear,
}: {
  notes: string[];
  onClear: () => void;
}) {
  return (
    <div
      data-testid="notes-card"
      className="w-full max-w-md p-6 bg-white rounded-2xl shadow-sm border border-[#DBDBE5] space-y-3"
    >
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-[#010507]">Agent notes</h2>
          <p className="text-xs text-[#57575B] mt-1">
            Written by the agent via its set_notes tool. Read here by the UI.
          </p>
        </div>
        {notes.length > 0 && (
          <button
            data-testid="notes-clear-button"
            type="button"
            onClick={onClear}
            className="text-xs text-[#57575B] hover:text-[#010507] underline"
          >
            Clear
          </button>
        )}
      </div>
      {notes.length === 0 ? (
        <p data-testid="notes-empty" className="text-sm text-[#838389] italic">
          No notes yet. Ask the agent to remember something.
        </p>
      ) : (
        <ul data-testid="notes-list" className="space-y-2">
          {notes.map((note, i) => (
            <li
              data-testid="note-item"
              key={`${i}::${note}`}
              className="text-sm text-[#010507] bg-[#FAFAFC] border border-[#E9E9EF] rounded-lg p-2.5"
            >
              {note}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
// @endregion[notes-card-render]
