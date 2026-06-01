// Docs-only snippet — not imported or rendered. Built-in-agent's
// shared-state-read-write demo at `page.tsx` does its rendering inline
// rather than splitting into a dedicated `notes-card.tsx`. The canonical
// `/shared-state` doc teaches the split-component shape, so this file
// shows what a minimal NotesCard would look like in the same shape, so
// the docs render real teaching code rather than a missing-snippet box.
//
// Mirrors the convention from `tool-rendering/render-flight-tool.snippet.tsx`.

import React from "react";

export interface NotesCardProps {
  notes: string[];
  onClear: () => void;
}

// @region[notes-card-render]
// Read-side render: this card reflects the agent-authored `notes` slice
// of shared state. The parent page passes `state.notes` in; we never
// touch agent state ourselves — we just render it. The Clear button is
// a small write-back, exposed as an `onClear` prop.
export function NotesCard({ notes, onClear }: NotesCardProps) {
  return (
    <div className="rounded border p-4 space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Agent notes</h2>
        {notes.length > 0 && (
          <button type="button" onClick={onClear} className="text-xs underline">
            Clear
          </button>
        )}
      </div>
      {notes.length === 0 ? (
        <p className="text-sm italic opacity-60">
          No notes yet. Ask the agent to remember something.
        </p>
      ) : (
        <ul className="list-disc list-inside text-sm">
          {notes.map((note, i) => (
            <li key={i}>{note}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
// @endregion[notes-card-render]
