"use client";

import Link from "next/link";
import { useAgentContext } from "@copilotkit/react-core/v2";
import { useSkinData } from "@/shell/skin-provider";
import { useBookstoreHref, useBookstoreSegments } from "@/skins/bookstore/href";
import type { BookstoreData } from "@/skins/bookstore/data/types";
import { formatUsd, GENRE_LABELS } from "@/skins/bookstore/data/query";
import { BookCover } from "@/skins/bookstore/components/book-cover";
import { cn } from "@/lib/utils";

export function BookPage() {
  const bookstoreHref = useBookstoreHref();
  const data = useSkinData<BookstoreData>();

  // /bookstore/book/<slug> — segments below the skin root are ["book", slug],
  // so index 1 is the slug. Read from the segments hook rather than the
  // pathname because `resolvePage` hands the shell a bare ComponentType with
  // no params prop (see the Skin contract), and the segments hook — unlike a
  // raw pathname split — is correct under a LOCK_SKIN deploy by construction.
  const slug = decodeURIComponent(useBookstoreSegments()[1] ?? "");
  const book = data.books.find((b) => b.slug === slug);

  // Readable registration must be unconditional — hooks cannot sit behind an
  // early return — so the not-found case reports itself honestly instead of
  // leaving the agent with the previous page's context.
  useAgentContext({
    description:
      "What is visibly on the book detail page the shopper is currently reading.",
    value: JSON.stringify(
      book
        ? {
            page: "book",
            title: book.title,
            author: book.author,
            translator: book.translator,
            genre: book.genre,
            format: book.format,
            price: formatUsd(book.priceCents),
            pages: book.pages,
            rating: book.rating,
            published: book.published,
            blurb: book.blurb,
            in_cart: data.cart.some((l) => l.bookId === book.id),
          }
        : { page: "book", error: `No book is filed under "${slug}".` },
    ),
  });

  if (!book) {
    return (
      <div className="mx-auto max-w-2xl rounded-md border border-dashed border-hairline p-8 text-center">
        <p className="text-sm text-ink-muted">
          No book is filed under &quot;{slug}&quot;.
        </p>
        <Link
          href={bookstoreHref()}
          className="mt-3 inline-block text-sm text-brand underline"
        >
          Back to the shelf
        </Link>
      </div>
    );
  }

  const inCart = data.cart.some((l) => l.bookId === book.id);

  return (
    <div className="mx-auto max-w-3xl">
      <Link
        href={bookstoreHref()}
        className="text-sm text-ink-muted hover:text-ink"
      >
        ← Back to the shelf
      </Link>

      <div className="mt-4 grid gap-6 sm:grid-cols-[200px_1fr]">
        <BookCover
          book={book}
          className={cn(data.lastAddedId === book.id && "ring-2 ring-brand")}
        />

        <div>
          <h1 className="bookstore-display text-3xl font-bold leading-tight tracking-tight text-ink">
            {book.title}
          </h1>
          <p className="mt-1 text-sm text-ink-muted">
            {book.author}
            {book.translator ? (
              <span className="italic"> · translated by {book.translator}</span>
            ) : null}
          </p>

          <p className="mt-4 text-sm leading-relaxed text-ink">{book.blurb}</p>

          <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
            {[
              ["Shelf", GENRE_LABELS[book.genre]],
              ["Format", book.format],
              ["Pages", String(book.pages)],
              ["Published", book.published],
              ["Rating", `${book.rating.toFixed(1)} / 5`],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
                  {label}
                </dt>
                <dd className="text-ink">{value}</dd>
              </div>
            ))}
          </dl>

          <div className="mt-6 flex items-center gap-3">
            <span className="bookstore-display text-2xl font-bold text-ink">
              {formatUsd(book.priceCents)}
            </span>
            <button
              type="button"
              onClick={() => data.addToCart(book.id)}
              className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-brand-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
            >
              Add to cart
            </button>
            {inCart ? (
              <span className="text-xs font-medium text-positive">
                In your cart
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
