"use client";

import React from "react";

// @region[notes-card-render]
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
          <h2 className="text-xl font-semibold text-[#010507]">Notes</h2>
          <p className="text-xs text-[#57575B] mt-1">
            Written by the agent via its set_notes tool. Read here by the UI.
          </p>
        </div>
        {notes.length > 0 && (
          <button
            data-testid="notes-clear"
            type="button"
            onClick={onClear}
            className="text-xs text-[#57575B] hover:text-[#010507] underline"
          >
            Clear
          </button>
        )}
      </div>
      {notes.length === 0 ? (
        <p className="text-sm text-[#838389] italic">
          No notes yet. Try: "Remember that I prefer morning meetings."
        </p>
      ) : (
        <ul className="space-y-2">
          {notes.map((note, i) => (
            // Stable key derived from content + index. Pure index keys
            // would reuse the same DOM node when the agent rewrites the
            // notes list (e.g. set_notes(["b","a"]) after set_notes(["a"]))
            // and selection / scroll state would attach to the wrong row.
            // Scoped to this demo because we don't control note-id
            // generation upstream — index disambiguates duplicate-content
            // entries without requiring a backend schema change.
            <li
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
