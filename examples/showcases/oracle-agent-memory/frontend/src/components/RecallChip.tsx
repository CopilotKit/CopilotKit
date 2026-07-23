"use client";

import { useState } from "react";

interface RecallChipProps {
  memories?: string;
}

const EMPTY_SENTINEL = "No relevant memories.";

/** Split the newline-separated recall result into clean preference lines. */
function parsePreferences(memories: string): string[] {
  return memories
    .split("\n")
    .map((line) => line.replace(/^[-•*]\s*/, "").trim())
    .filter((line) => line.length > 0 && line !== EMPTY_SENTINEL);
}

export function RecallChip({ memories }: RecallChipProps) {
  const [open, setOpen] = useState(false);
  const hasMemories = Boolean(memories && memories.trim().length > 0);

  // Still recalling — non-interactive placeholder.
  if (!hasMemories) {
    return (
      <span className="text-xs rounded-full bg-gray-100 px-2.5 py-1 text-gray-600 inline-flex items-center gap-1">
        🧠 Recalling your preferences…
      </span>
    );
  }

  const prefs = parsePreferences(memories as string);
  const hasPrefs = prefs.length > 0;

  return (
    <div className="mt-3 inline-flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="text-xs rounded-full bg-gray-100 px-2.5 py-1 text-gray-600 inline-flex items-center gap-1 hover:bg-gray-200 transition-colors cursor-pointer"
      >
        🧠 Remembered your preferences
        <svg
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          className={`transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden="true"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div className="rounded-lg border border-gray-200 bg-white shadow-sm px-3 py-2 text-xs text-gray-600">
          {hasPrefs ? (
            <ul className="space-y-1">
              {prefs.map((pref, i) => (
                <li key={i} className="flex items-start gap-1.5">
                  <span className="text-gray-300 leading-none mt-0.5">•</span>
                  <span>{pref}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-gray-400">Nothing saved yet for this query.</p>
          )}
        </div>
      )}
    </div>
  );
}
