"use client";

import Link from "next/link";
import type { Book } from "@/skins/bookstore/data/types";
import { formatUsd } from "@/skins/bookstore/data/query";
import { BookCover } from "./book-cover";
import { cn } from "@/lib/utils";

/**
 * One book, everywhere: the browse grid, the gen-UI rows the agent renders in
 * chat, and the recommendation cards. One component so a book that the agent
 * shows and a book the shopper browses are visibly the same object.
 *
 * `highlighted` is the add-to-cart affordance (spec §6.2) — driven by the
 * store's `lastAddedId`, so the ring appears wherever the book is on screen
 * when the agent adds it.
 */
export function BookCard({
  book,
  href,
  highlighted = false,
  onAdd,
}: {
  book: Book;
  /** Omit to render a non-navigating card (the chat transcript does). */
  href?: string;
  highlighted?: boolean;
  onAdd?: (bookId: string) => void;
}) {
  const cover = <BookCover book={book} />;

  return (
    <div
      data-slug={book.slug}
      className={cn(
        "flex flex-col gap-2 rounded-md border border-hairline bg-surface p-2.5 transition-shadow",
        highlighted && "ring-2 ring-brand",
      )}
    >
      {href ? (
        <Link href={href} aria-label={`Open ${book.title}`}>
          {cover}
        </Link>
      ) : (
        cover
      )}

      <div className="min-w-0">
        <div
          className="truncate text-sm font-semibold text-ink"
          title={book.title}
        >
          {href ? <Link href={href}>{book.title}</Link> : book.title}
        </div>
        <div className="truncate text-xs text-ink-muted">{book.author}</div>
        {book.translator ? (
          <div className="truncate text-[11px] italic text-ink-muted">
            tr. {book.translator}
          </div>
        ) : null}
      </div>

      <div className="mt-auto flex items-center justify-between gap-2">
        <div className="flex items-baseline gap-1.5">
          <span className="text-sm font-semibold text-ink">
            {formatUsd(book.priceCents)}
          </span>
          <span className="rounded-sm border border-hairline px-1 py-px text-[10px] uppercase tracking-wide text-ink-muted">
            {book.format}
          </span>
        </div>
        {onAdd ? (
          <button
            type="button"
            onClick={() => onAdd(book.id)}
            className="rounded-md bg-brand px-2.5 py-1 text-xs font-semibold text-brand-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
          >
            Add
          </button>
        ) : null}
      </div>
    </div>
  );
}
