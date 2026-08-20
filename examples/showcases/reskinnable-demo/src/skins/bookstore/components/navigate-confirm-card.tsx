"use client";

import type { BookQuery } from "@/skins/bookstore/data/types";
import {
  formatUsd,
  GENRE_LABELS,
  SORT_LABELS,
} from "@/skins/bookstore/data/query";

/**
 * Beat 3c's confirmation. What earns the beat is that the agent NAMES the levers
 * it is about to pull BEFORE it navigates — so the audience sees a maneuver
 * through the app's real controls rather than a link being followed.
 *
 * Exported separately from the card because the tool ALSO speaks this list back
 * to the agent, and one function means the confirmation and the spoken summary
 * can never describe different filters.
 */
export function describeQuery(query: BookQuery): string[] {
  const parts: string[] = [];
  if (query.genre) parts.push(`Shelf: ${GENRE_LABELS[query.genre]}`);
  if (query.format) parts.push(`Format: ${query.format}`);
  if (query.maxCents !== undefined)
    parts.push(`Price: under ${formatUsd(query.maxCents)}`);
  if (query.sort) parts.push(`Sort: ${SORT_LABELS[query.sort]}`);
  return parts.length > 0 ? parts : ["No filters — the whole shelf"];
}

export function NavigateConfirmCard({
  query,
  onConfirm,
  onCancel,
}: {
  query: BookQuery;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="rounded-md border border-hairline bg-surface p-3.5 text-sm">
      <div className="font-semibold text-ink">Change what the shelf shows?</div>
      <ul className="mt-2 flex flex-col gap-1">
        {describeQuery(query).map((part) => (
          <li key={part} className="text-xs text-ink-muted">
            · {part}
          </li>
        ))}
      </ul>
      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={onConfirm}
          className="rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-brand-foreground transition-opacity hover:opacity-90"
        >
          Show me
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="text-xs text-ink-muted underline hover:text-ink"
        >
          No thanks
        </button>
      </div>
    </div>
  );
}
