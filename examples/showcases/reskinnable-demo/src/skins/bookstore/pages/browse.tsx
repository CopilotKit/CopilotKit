"use client";

import { useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAgentContext } from "@copilotkit/react-core/v2";
import { useSkinData } from "@/shell/skin-provider";
import { useBookstoreHref } from "@/skins/bookstore/href";
import { bookPath, browseTarget } from "@/skins/bookstore/nav-target";
import type { BookQuery, BookstoreData } from "@/skins/bookstore/data/types";
import {
  bookQueryToParams,
  filterBooks,
  formatUsd,
  GENRE_LABELS,
  parseBookQuery,
  SORT_LABELS,
} from "@/skins/bookstore/data/query";
import { BookCard } from "@/skins/bookstore/components/book-card";
import { FilterBar } from "@/skins/bookstore/components/filter-bar";

/**
 * The catalog shelf, and the skin's index page (`resolvePage([])` and
 * `resolvePage(["browse"])` both land here — see `layout.tsx`'s
 * `ROUTE_READABLE_NAME` map, which folds both onto the same "browse" name).
 */
export function BrowsePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const skinHref = useBookstoreHref();
  const data = useSkinData<BookstoreData>();

  // The levers are the URL. That is what makes beat 3c real rather than
  // cosmetic: the agent pushes a route, the page reads it back, and a
  // presenter can read the query string aloud.
  const query: BookQuery = useMemo(
    () => parseBookQuery(new URLSearchParams(searchParams.toString())),
    [searchParams],
  );

  const visible = useMemo(
    () => filterBooks(data.books, query),
    [data.books, query],
  );

  const apply = (next: BookQuery) => {
    const params = bookQueryToParams(next);
    // Through browseTarget, never `` `/bookstore${qs ? `?${qs}` : ""}` `` — under
    // LOCK_SKIN the href base is "/", and concatenating a query string onto a
    // hand-rolled `/bookstore` prefix is exactly the literal this skin must
    // never carry (see nav-target.ts).
    router.push(browseTarget(skinHref, params.toString()));
  };

  // Human summary of the applied levers, built ONCE and reused by both the
  // subtitle and the readable below, so the agent can never describe a filter
  // the page is not actually showing.
  const applied = useMemo(() => {
    const parts: string[] = [];
    if (query.genre) parts.push(GENRE_LABELS[query.genre]);
    if (query.format) parts.push(query.format);
    if (query.maxCents !== undefined)
      parts.push(`under ${formatUsd(query.maxCents)}`);
    if (query.sort) parts.push(SORT_LABELS[query.sort].toLowerCase());
    return parts;
  }, [query]);

  // ── BEAT 3b ──────────────────────────────────────────────────────────────
  // THE ON-SCREEN READABLE — the richest one in the skin. It names the page,
  // the ACTIVE FILTERS, the visible count and the rows actually RENDERED
  // below, in the order shown, so "what's on my screen?" is answered from the
  // screen rather than from the whole catalog. This `description` must stay
  // distinct from the layout's route readable and from book.tsx's/cart.tsx's
  // (`page: "book"` / `page: "cart"`) so each page answers differently and
  // correctly. Deliberately UNCAPPED: `visible` is `filterBooks(data.books,
  // query)`, a filtered subset of the catalog, so it is at most the whole
  // shelf and `visible_count` can never disagree with the list below it. A
  // literal cap here would reintroduce the bug this readable exists to avoid
  // — `visible_count: N` reported alongside fewer than N rows — the moment
  // the catalog grows past the literal, unless it also emitted a truncation
  // marker. It would also be inconsistent with tools.tsx, which already
  // ships the entire catalog to the agent as context, uncapped and with
  // blurbs; and it would contradict agent.ts's premise that the catalog
  // reaches the agent as context "rather than through a search tool (25
  // books fit)". If the catalog ever outgrows context, the fix is a search
  // tool, not a silent slice.
  useAgentContext({
    description:
      "What is visibly on the Browse page right now: the filters currently applied (as set in the URL), how many books are showing, and the books themselves in the order they appear.",
    value: JSON.stringify({
      page: "browse",
      applied_filters: applied.length > 0 ? applied : ["none"],
      visible_count: visible.length,
      books: visible.map((b) => ({
        title: b.title,
        author: b.author,
        translator: b.translator,
        genre: b.genre,
        format: b.format,
        price: formatUsd(b.priceCents),
        rating: b.rating,
        slug: b.slug,
      })),
    }),
  });

  const showRank = query.sort === "price_asc" || query.sort === "price_desc";

  return (
    <div className="mx-auto max-w-5xl">
      <header className="mb-4">
        <h1 className="bookstore-display text-2xl font-bold tracking-tight text-ink">
          {query.genre ? GENRE_LABELS[query.genre] : "Everything on the shelf"}
        </h1>
        <p className="mt-1 text-sm text-ink-muted">
          {visible.length} {visible.length === 1 ? "book" : "books"}
          {applied.length > 0 ? ` · ${applied.join(" · ")}` : ""}
        </p>
      </header>

      <FilterBar query={query} onChange={apply} />

      {visible.length === 0 ? (
        <div className="rounded-md border border-dashed border-hairline p-8 text-center text-sm text-ink-muted">
          Nothing on this shelf matches those filters.
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {visible.map((book, index) => (
            <div key={book.id} className="relative">
              {/* Rank badge when sorted by price, so the ORDER is legible
                  rather than merely correct — the audience can see the sort
                  landed. */}
              {showRank ? (
                <span className="absolute -left-1 -top-1 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-brand text-[10px] font-bold text-brand-foreground">
                  {index + 1}
                </span>
              ) : null}
              <BookCard
                book={book}
                href={skinHref(bookPath(book.slug))}
                highlighted={data.lastAddedId === book.id}
                onAdd={data.addToCart}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
