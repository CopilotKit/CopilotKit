"use client";

import React from "react";

export interface Note {
  id: string;
  title: string;
  body: string;
}

const SAMPLE_NOTES: Note[] = [
  {
    id: "1",
    title: "Q4 strategy",
    body: "Lean into agentic UX. Ship 3 demo videos by mid-November.",
  },
  {
    id: "2",
    title: "Standup follow-ups",
    body: "Atai blocked on review queue. Pair with Daisy on the runtime fix.",
  },
  {
    id: "3",
    title: "Reading list",
    body: "Cognitive Architectures for Language Agents (Sumers et al, 2024).",
  },
];

export function NotesCard() {
  return (
    <div className="rounded-2xl border border-[#DBDBE5] bg-white p-5 shadow-sm">
      <h3 className="text-sm font-semibold text-[#010507] mb-3">
        Local notes (frontend-only DB)
      </h3>
      <ul className="space-y-2">
        {SAMPLE_NOTES.map((n) => (
          <li
            key={n.id}
            className="rounded-lg bg-[#FAFAFC] border border-[#E9E9EF] p-3"
          >
            <div className="text-sm font-medium text-[#010507]">{n.title}</div>
            <div className="text-xs text-[#57575B] mt-1">{n.body}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export async function queryLocalNotes(query: string): Promise<Note[]> {
  // Simulated async DB query — in a real app this would hit IndexedDB,
  // localStorage, or a workspace API.
  await new Promise((r) => setTimeout(r, 350));
  const q = query.toLowerCase();
  return SAMPLE_NOTES.filter(
    (n) =>
      n.title.toLowerCase().includes(q) || n.body.toLowerCase().includes(q),
  );
}
