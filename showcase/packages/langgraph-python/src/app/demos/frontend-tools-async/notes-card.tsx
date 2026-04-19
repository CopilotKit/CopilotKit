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

/**
 * Branded card rendering the client-side "notes DB query" result.
 * Mirrors the per-tool render path used by other tool-rendering cells —
 * but the `notes` array is awaited from an async handler living entirely
 * in the browser (no backend tool involved).
 */
export function NotesCard({ loading, keyword, notes }: NotesCardProps) {
  return (
    <div
      data-testid="notes-card"
      className="rounded-xl mt-4 mb-4 max-w-md w-full bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-lg"
    >
      <div className="p-4">
        <div className="flex items-center justify-between">
          <div>
            <h3
              data-testid="notes-keyword"
              className="text-lg font-bold capitalize"
            >
              Notes matching &ldquo;{keyword}&rdquo;
            </h3>
            <p className="text-white/80 text-xs">
              {loading
                ? "Querying local notes DB..."
                : `${notes?.length ?? 0} match${(notes?.length ?? 0) === 1 ? "" : "es"}`}
            </p>
          </div>
          <div className="text-3xl" aria-hidden>
            {loading ? "..." : "notes"}
          </div>
        </div>

        {!loading && notes && notes.length > 0 && (
          <ul
            data-testid="notes-list"
            className="mt-4 pt-4 border-t border-white/30 space-y-2 text-sm"
          >
            {notes.map((n) => (
              <li
                key={n.id}
                data-testid={`note-${n.id}`}
                className="bg-white/10 rounded-md p-2"
              >
                <p className="font-medium">{n.title}</p>
                <p className="text-white/80 text-xs mt-0.5">{n.excerpt}</p>
                {n.tags && n.tags.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {n.tags.map((t) => (
                      <span
                        key={t}
                        className="text-[10px] bg-white/20 rounded px-1.5 py-0.5"
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
          <p className="mt-4 pt-4 border-t border-white/30 text-sm text-white/80">
            No notes matched.
          </p>
        )}
      </div>
    </div>
  );
}
