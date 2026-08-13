"use client";

import type {
  BookQuery,
  Format,
  Genre,
  SortKey,
} from "@/skins/bookstore/data/types";
import {
  BOOK_GENRES,
  BOOK_SORTS,
  GENRE_LABELS,
  SORT_LABELS,
} from "@/skins/bookstore/data/query";
import { cn } from "@/lib/utils";

/**
 * The levers, and the visible proof the agent pulled them (beat 3c).
 *
 * The affordance is that the CONTROLS light up, not the rows: a highlighted row
 * only says "here is a result", while a highlighted control says "something set
 * this filter". Every active lever carries `data-active="true"` — which is both
 * the styling hook and what the test asserts, so the affordance cannot silently
 * regress into a plain unstyled button.
 *
 * Clicking an already-active lever CLEARS it. The agent never relies on that
 * (it sends a full query), but a shopper who wants the shelf back should not
 * have to hunt for a reset.
 */

/** The price caps offered as one-click levers. Cents, matching BookQuery. */
export const PRICE_CAPS: readonly { label: string; maxCents: number }[] =
  Object.freeze([
    { label: "Under $15", maxCents: 1500 },
    { label: "Under $20", maxCents: 2000 },
    { label: "Under $30", maxCents: 3000 },
  ]);

// No seed book has format: "ebook" (see data/seed.ts), so this lever always
// yields an empty shelf today. Keep it anyway: Maya's seeded preference reads
// "paperback or ebook only", so the browseWithFilters tool can set
// format=ebook from the agent side. If the bar had no Ebook lever, that
// agent-applied filter would be invisible on screen — and an invisible
// applied lever is unrecoverable, whereas a zero-result shelf is already
// handled by the browse page's empty state. Do not filter this list down to
// what the catalog currently has.
const FORMAT_LABELS: Record<Format, string> = {
  paperback: "Paperback",
  hardcover: "Hardcover",
  ebook: "Ebook",
};

function Lever({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-active={active}
      onClick={onClick}
      className={cn(
        "rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
        active
          ? // The activeSelect treatment. Brand-tinted and bolder, so a lever
            // set from the URL by the agent is unmistakable on a projector.
            "border-brand/50 bg-brand-soft font-semibold text-brand"
          : "border-hairline bg-surface text-ink-muted hover:bg-surface-muted hover:text-ink",
      )}
    >
      {label}
    </button>
  );
}

function Group({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="mr-1 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
        {title}
      </span>
      {children}
    </div>
  );
}

export function FilterBar({
  query,
  onChange,
}: {
  query: BookQuery;
  onChange: (next: BookQuery) => void;
}) {
  // Merge-and-prune: setting a lever keeps the others, and clearing one deletes
  // the key rather than storing `undefined` — so `bookQueryToParams` never emits
  // an empty `?genre=`.
  const set = <K extends keyof BookQuery>(key: K, value: BookQuery[K]) => {
    const next: BookQuery = { ...query };
    if (value === undefined || next[key] === value) delete next[key];
    else next[key] = value;
    onChange(next);
  };

  return (
    <div className="mb-5 flex flex-col gap-2.5 rounded-md border border-hairline bg-surface p-3">
      <Group title="Shelf">
        {BOOK_GENRES.map((genre: Genre) => (
          <Lever
            key={genre}
            label={GENRE_LABELS[genre]}
            active={query.genre === genre}
            onClick={() => set("genre", genre)}
          />
        ))}
      </Group>
      <Group title="Format">
        {(Object.keys(FORMAT_LABELS) as Format[]).map((format) => (
          <Lever
            key={format}
            label={FORMAT_LABELS[format]}
            active={query.format === format}
            onClick={() => set("format", format)}
          />
        ))}
      </Group>
      <Group title="Price">
        {PRICE_CAPS.map((cap) => (
          <Lever
            key={cap.maxCents}
            label={cap.label}
            active={query.maxCents === cap.maxCents}
            onClick={() => set("maxCents", cap.maxCents)}
          />
        ))}
      </Group>
      <Group title="Sort">
        {BOOK_SORTS.map((sort: SortKey) => (
          <Lever
            key={sort}
            label={SORT_LABELS[sort]}
            active={query.sort === sort}
            onClick={() => set("sort", sort)}
          />
        ))}
      </Group>
    </div>
  );
}
