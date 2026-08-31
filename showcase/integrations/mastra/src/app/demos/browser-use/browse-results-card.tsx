"use client";

import React from "react";

// Rich per-tool renderer for the `browse_web` backend tool (Browser Use demo).
//
// Registered in chat.tsx via `useRenderTool({ name: "browse_web", ... })`.
// While the local browser is navigating, it shows a compact loading state so
// the chat doesn't look frozen; once results arrive it renders a list of
// browsed results (Hacker News stories or a page-read summary). If the tool
// reports an error (e.g. missing local Chromium binary), it renders a clear
// error banner instead of pretending the browse succeeded.

export interface BrowseResult {
  title?: string;
  url?: string;
  points?: number;
  source?: string;
}

export interface BrowseResultsCardProps {
  loading: boolean;
  task: string;
  mode?: "hackernews" | "page";
  results: BrowseResult[];
  text?: string;
  error?: string;
}

export function BrowseResultsCard({
  loading,
  task,
  mode,
  results,
  text,
  error,
}: BrowseResultsCardProps) {
  const heading =
    mode === "page"
      ? "Page read"
      : mode === "hackernews"
        ? "Top stories"
        : "Browsing";

  return (
    <div
      data-testid="browse-results-card"
      className="my-3 rounded-2xl border border-[#DBDBE5] bg-white p-5 shadow-sm"
    >
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span
            className="flex h-8 w-8 items-center justify-center rounded-full bg-[#BEC2FF1A] text-[#010507]"
            aria-hidden
          >
            🌐
          </span>
          <div className="font-semibold text-[#010507]">{heading}</div>
        </div>
        {loading ? (
          <span className="text-[10px] uppercase tracking-[0.14em] text-[#57575B]">
            browsing…
          </span>
        ) : error ? (
          <span className="rounded-full border border-[#F1B0B0] bg-[#FDEAEA] px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.14em] text-[#B42318]">
            error
          </span>
        ) : (
          <span className="rounded-full border border-[#DBDBE5] bg-[#F7F7F9] px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.14em] text-[#57575B]">
            {results.length} result{results.length === 1 ? "" : "s"}
          </span>
        )}
      </div>

      {loading ? (
        <div className="space-y-2">
          <Skeleton />
          <Skeleton />
          <Skeleton />
        </div>
      ) : error ? (
        <p
          data-testid="browse-error"
          className="text-sm text-[#B42318] leading-relaxed"
        >
          {error}
        </p>
      ) : (
        <>
          <ul className="space-y-2">
            {results.length === 0 ? (
              <li className="text-sm italic text-[#57575B]">
                No results returned.
              </li>
            ) : (
              results.map((r, i) => (
                <li
                  key={`${r.url ?? r.title ?? "result"}-${i}`}
                  data-testid="browse-result-row"
                  className="flex items-start justify-between gap-3 rounded-xl border border-[#E9E9EF] bg-[#FAFAFC] px-3 py-2.5 text-sm"
                >
                  <div className="min-w-0">
                    {r.url ? (
                      <a
                        href={r.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium text-[#010507] hover:underline break-words"
                      >
                        {r.title ?? r.url}
                      </a>
                    ) : (
                      <span className="font-medium text-[#010507] break-words">
                        {r.title ?? "—"}
                      </span>
                    )}
                    {r.source ? (
                      <div className="mt-0.5 text-xs text-[#838389]">
                        {r.source}
                      </div>
                    ) : null}
                  </div>
                  {typeof r.points === "number" ? (
                    <span className="shrink-0 font-mono text-xs font-medium text-[#189370]">
                      {r.points} pts
                    </span>
                  ) : null}
                </li>
              ))
            )}
          </ul>
          {text ? (
            <p className="mt-3 border-t border-[#E9E9EF] pt-3 text-xs text-[#57575B] leading-relaxed line-clamp-6">
              {text}
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}

function Skeleton() {
  return (
    <div className="h-10 animate-pulse rounded-xl bg-[#F0F0F4]" aria-hidden />
  );
}
