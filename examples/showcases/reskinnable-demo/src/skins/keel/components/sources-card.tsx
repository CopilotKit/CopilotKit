"use client";

import { FileText, ArrowUpRight } from "lucide-react";
import { ChatSurface } from "@/skins/keel/components/chat-surface";
import { dedupeCitations } from "@/skins/keel/knowledge/dedupe-citations";
import type { Citation } from "@/skins/keel/knowledge/types";

/**
 * The `showSources` chat surface: the citations an answer actually used,
 * rendered as clickable rows so a citation resolves into the real app.
 * Presentational only — the click is delegated to `onOpen`.
 */
export function SourcesCard({
  citations,
  onOpen,
}: {
  citations: Citation[];
  onOpen: (c: Citation) => void;
}) {
  // The agent supplies (docId, sectionId) pairs and may repeat one; a duplicate
  // passage adds no information and would collide the `docId#sectionId` key
  // below, so collapse to one row per distinct passage before rendering.
  const rows = dedupeCitations(citations);

  if (rows.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-hairline bg-surface p-3 text-xs text-ink-muted">
        The policy library has nothing covering that.
      </div>
    );
  }

  return (
    // Rooted in `ChatSurface` (which carries `pointer-events-auto`) so the
    // clickable citation rows survive the `pointer-events: none` CopilotKit
    // paints on `useComponent` renders. See ChatSurface for the full rationale.
    <ChatSurface className="rounded-lg border border-hairline bg-surface p-3 shadow-soft">
      <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
        <FileText className="h-3.5 w-3.5" />
        Sources
      </div>
      <ul className="flex flex-col gap-1.5">
        {rows.map((c) => (
          <li key={`${c.docId}#${c.sectionId}`}>
            <button
              type="button"
              onClick={() => onOpen(c)}
              className="group flex w-full items-start gap-2 rounded-md border border-hairline bg-surface-muted p-2 text-left transition-colors hover:border-brand/60 hover:bg-brand-soft"
            >
              <span className="mt-0.5 shrink-0 rounded-sm bg-surface px-1.5 py-0.5 font-mono text-[11px] font-semibold text-brand">
                {c.ref}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1 text-xs font-medium text-ink">
                  <span className="truncate">{c.heading}</span>
                  <ArrowUpRight className="h-3 w-3 shrink-0 text-ink-muted group-hover:text-brand" />
                </span>
                <span className="mt-0.5 line-clamp-2 block text-[11px] leading-snug text-ink-muted">
                  {c.snippet}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </ChatSurface>
  );
}
