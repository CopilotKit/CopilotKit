"use client";

import type { Book } from "@/skins/bookstore/data/types";
import { useBookstoreHref } from "@/skins/bookstore/href";
import { bookPath } from "@/skins/bookstore/nav-target";
import { BookCard } from "./book-card";

/**
 * The beat-4 surface. Two things make it the memory beat rather than a nicer
 * book list:
 *
 *  1. `note` — the slot where the agent NAMES the preference it recalled ("You
 *     skip hardcovers and cap a book at $20, so —"). Without this the audience
 *     sees a normal recommendation and the recall is invisible, which is the
 *     documented way this beat dies.
 *  2. `reason` per pick — one line each, which the seeded memory explicitly asks
 *     for, so obeying the preference is observable at the level of each card.
 *
 * `highlightedBookId` is threaded in so an add-to-cart lands with the SAME ~2s
 * ring the browse grid and `showBooks` rows give it: this is the surface most
 * likely to be on screen when "add the top pick" fires, and every mutation needs a
 * visible affordance. The highlight stays a `BookCard` prop — nothing new is added
 * to `BookCard` itself.
 */
export function RecommendationCard({
  note,
  picks,
  highlightedBookId,
}: {
  note?: string;
  picks: { book: Book; reason?: string }[];
  highlightedBookId?: string | null;
}) {
  const skinHref = useBookstoreHref();

  return (
    <div className="flex flex-col gap-3">
      {note ? (
        <p className="rounded-md border-l-2 border-brand bg-brand-soft px-3 py-2 text-sm italic text-ink">
          {note}
        </p>
      ) : null}

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        {picks.map(({ book, reason }) => (
          <div key={book.id} className="flex flex-col gap-1.5">
            <BookCard
              book={book}
              href={skinHref(bookPath(book.slug))}
              highlighted={book.id === highlightedBookId}
            />
            {reason ? (
              <p className="text-[11px] leading-snug text-ink-muted">
                {reason}
              </p>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
