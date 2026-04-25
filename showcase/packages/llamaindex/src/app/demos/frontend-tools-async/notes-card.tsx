"use client";

import React from "react";

export interface Note {
  id: string;
  title: string;
  excerpt: string;
  tags?: string[];
}

export interface NotesCardProps {
  loading: boolean;
  keyword: string;
  notes?: Note[];
}

export function NotesCard({ loading, keyword, notes }: NotesCardProps) {
  return (
    <div
      data-testid="notes-card"
      className="rounded-2xl mt-4 mb-4 max-w-md w-full bg-white border border-[#DBDBE5] shadow-sm"
    >
      <div className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-[0.14em] text-[#57575B] mb-1">
              Notes DB
            </div>
            <h3
              data-testid="notes-keyword"
              className="text-base font-semibold text-[#010507]"
            >
              Matching &ldquo;{keyword}&rdquo;
            </h3>
            <p className="text-[#57575B] text-xs mt-0.5">
              {loading
                ? "Querying local notes DB..."
                : `${notes?.length ?? 0} match${(notes?.length ?? 0) === 1 ? "" : "es"}`}
            </p>
          </div>
          <div className="text-xl" aria-hidden>
            {loading ? "..." : "Notes"}
          </div>
        </div>

        {!loading && notes && notes.length > 0 && (
          <ul
            data-testid="notes-list"
            className="mt-4 pt-4 border-t border-[#E9E9EF] space-y-2 text-sm"
          >
            {notes.map((n) => (
              <li
                key={n.id}
                data-testid={`note-${n.id}`}
                className="rounded-xl border border-[#E9E9EF] bg-[#FAFAFC] p-2.5"
              >
                <p className="font-medium text-[#010507]">{n.title}</p>
                <p className="text-[#57575B] text-xs mt-0.5">{n.excerpt}</p>
                {n.tags && n.tags.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {n.tags.map((t) => (
                      <span
                        key={t}
                        className="text-[10px] font-medium uppercase tracking-[0.1em] bg-white border border-[#DBDBE5] text-[#57575B] rounded-full px-1.5 py-0.5"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        {!loading && (!notes || notes.length === 0) && (
          <p className="mt-4 pt-4 border-t border-[#E9E9EF] text-sm text-[#838389] italic">
            No notes matched.
          </p>
        )}
      </div>
    </div>
  );
}
