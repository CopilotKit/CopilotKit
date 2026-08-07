"use client";

import Link from "next/link";
import { ArrowUpRight, Sparkles } from "lucide-react";
import { useBoard } from "../../data/hooks";
import { useVantageHref } from "../../href";
import { CardShell } from "./card-shell";

/**
 * Stands in the transcript for a board that now lives in the APP. The link is
 * the point of beat 3d: the artifact has a URL, so it is reachable after this
 * conversation is gone.
 *
 * `note` is beat 4's "why it looks like this" slot. Phase 1 leaves it unset.
 */
export function BoardCard({
  boardId,
  note,
}: {
  boardId: string;
  note?: string;
}) {
  const { board, loading } = useBoard(boardId);
  const vantageHref = useVantageHref();
  // Built once so the link and the URL printed beneath it can never disagree —
  // the printed path is part of the beat ("it has a URL"), so a locked deploy
  // must show the prefix-free one it actually serves.
  const boardPath = board ? vantageHref(`boards/${board.slug}`) : "";
  return (
    <CardShell title="Filed to your boards" note={note} loading={loading}>
      {board ? (
        <div className="space-y-2">
          <Link
            href={boardPath}
            className="flex items-center gap-1.5 text-sm font-semibold text-brand hover:underline"
          >
            {board.title}
            <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
          <p className="text-xs text-ink-muted">{board.summary}</p>
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1 rounded bg-brand-soft px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-brand">
              <Sparkles className="h-3 w-3" />
              Generated
            </span>
            <span className="nw-figure text-[11px] text-ink-muted">
              {board.tiles.length} tiles · {boardPath}
            </span>
          </div>
        </div>
      ) : (
        <div className="text-xs text-ink-muted">
          That board is no longer available.
        </div>
      )}
    </CardShell>
  );
}
