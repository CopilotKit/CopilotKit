"use client";

import { useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import {
  ToolCallStatus,
  useAgentContext,
  useComponent,
  useFrontendTool,
  useHumanInTheLoop,
} from "@copilotkit/react-core/v2";
import { useSkinData } from "@/shell/skin-provider";
import { useShopper } from "@/skins/bookstore/providers";
import { useBookstoreHref } from "@/skins/bookstore/href";
import { bookPath, browseTarget } from "@/skins/bookstore/nav-target";
import type {
  Book,
  BookQuery,
  BookstoreData,
  Format,
  Genre,
  SortKey,
} from "@/skins/bookstore/data/types";
import {
  bookQueryToParams,
  cartTotals,
  formatUsd,
} from "@/skins/bookstore/data/query";
import type { CartPricing } from "@/skins/bookstore/data/query";
import {
  BOOKSTORE_CLUB,
  localCalendarDay,
  nextMeetingISO,
} from "@/skins/bookstore/data/club";
import { BookCard } from "@/skins/bookstore/components/book-card";
import {
  describeQuery,
  NavigateConfirmCard,
} from "@/skins/bookstore/components/navigate-confirm-card";
import { CheckoutCard } from "@/skins/bookstore/components/checkout-card";
import { RecommendationCard } from "@/skins/bookstore/components/recommendation-card";

/**
 * What THIS SESSION already knows about a checkout call the shopper ANSWERED.
 *
 * A human-in-the-loop call the user answered does not always replay WITH its
 * result when a thread is reopened: banking hit exactly this with `setCardPin`,
 * which replays with status `inProgress` and no result at all, leaving the
 * answered card stuck on a blank form. Recording the outcome as the shopper
 * answers lets the render show a receipt instead.
 *
 * It holds the order id, the item count, the total and `last4` — NEVER the card
 * number, the expiry or the CVV. Module scope, so it survives switching between
 * threads (the case that matters); a full page reload clears it, and the render
 * then falls back to the replayed result.
 */
const answeredCheckouts = new Map<
  string,
  { orderId: string; itemCount: number; totalCents: number; last4: string }
>();

/**
 * The same idea for `browseWithFilters`, which is the pill immediately before the
 * durable-thread beat is shown.
 *
 * Without it an ANSWERED filter change that replays with no result falls through
 * to the terminal "Updating the shelf…" placeholder, which asserts nothing about
 * which levers were applied. No secret is involved here: the stored value is the
 * very summary line that was passed to `respond()`.
 */
const answeredNavigations = new Map<string, { summary: string }>();

/**
 * The bookstore skin's registration point: frontend tools, gen-UI components and
 * agent-context readables. Takes no props and renders null.
 *
 * FOUR RULES, each of which fails SILENTLY if broken:
 *
 *  1. Every registration closes with a DEPS ARRAY. Omit it and the closure
 *     captures registration-time data forever — for this skin, the pre-hydration
 *     empty cart — while the agent narrates confidently over it. It compiles,
 *     lints and passes tests. That is why the only `exhaustive-deps` disable in
 *     this file is the ONE on the cart readable, which has a documented reason.
 *  2. `useComponent` renders receive the parsed args DIRECTLY
 *     (`render: ({ bookIds }) => …`). Only `useFrontendTool` /
 *     `useHumanInTheLoop` renders receive `{ args, status, respond, result }`.
 *  3. Renders key off `result`, never off `status`. Reopening a thread replays
 *     recorded calls with their stored result and no live status transition, so a
 *     status-keyed render looks perfect live and renders blank on reload —
 *     exactly when beat 2 is being demonstrated.
 *  4. Streaming parses are PARTIAL, so default every array/object arg
 *     (`(bookIds ?? [])`). During streaming they may still be undefined.
 */
export function BookstoreTools() {
  const router = useRouter();
  const data = useSkinData<BookstoreData>();
  const { shopper } = useShopper();
  // Every in-skin link and `router.push` goes through the skin's builder, never
  // a `/bookstore/...` literal — under `LOCK_SKIN=bookstore` the tenant segment
  // must not reappear in the address bar. Memoized on its base, so it is
  // dep-array-safe.
  const skinHref = useBookstoreHref();

  /**
   * The live store, reachable from a handler WITHOUT taking a dep on it.
   *
   * `openCheckout` (below) is its reader, and registers with EMPTY deps. That
   * tool WRITES: `placeOrder` mutates the cart, so a `data.cart` dep would tear
   * the tool down in the middle of its own call and lose `respond()`, failing
   * the thread with "Tool result is missing for tool call". Reading the ref is
   * how its render still sees the live cart without taking that dep.
   */
  const dataRef = useRef<BookstoreData>(data);
  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  // Resolve ids → books once, so every render below agrees about what a book id
  // means and no render re-scans the catalog per card.
  const byId = useMemo(
    () => new Map(data.books.map((b) => [b.id, b] as const)),
    [data.books],
  );

  // ── Readables ─────────────────────────────────────────────────────────────
  // These three are GLOBAL: who is shopping, what the catalog holds, what is in
  // the cart. The ROUTE readable lives in layout.tsx and the ON-SCREEN readables
  // live in the page components ("What is visibly on …"). All three layers are
  // needed for beat 3b, so keep these descriptions framed as store-wide state
  // rather than as page state.

  useAgentContext({
    description:
      "The shopper you are serving, store-wide. Their durable memory is scoped to this identity, so what you recall applies to this person only.",
    value: JSON.stringify({ name: shopper.name, id: shopper.id }),
  });

  // The whole catalog, as the agent's shelf. Small enough (25 books) to pass
  // entirely, which is what lets the agent answer "what's new in translated
  // fiction?" without a search tool.
  const catalogSummary = useMemo(
    () =>
      JSON.stringify(
        data.books.map((b) => ({
          id: b.id,
          slug: b.slug,
          title: b.title,
          author: b.author,
          translator: b.translator,
          genre: b.genre,
          format: b.format,
          price: formatUsd(b.priceCents),
          price_cents: b.priceCents,
          pages: b.pages,
          rating: b.rating,
          published: b.published,
          new_and_notable: b.isNew,
          blurb: b.blurb,
        })),
      ),
    [data.books],
  );

  useAgentContext({
    description:
      "The full store catalog, independent of what is on screen: every book with its id, slug, shelf (genre), format, price in dollars and cents, page count, rating, publication year, whether it is New & Notable, and a one-line blurb. Use these ids when calling showBooks, recommendBooks or addToCart — never invent one.",
    value: catalogSummary,
  });

  const cartSummary = useMemo(() => {
    // The SAME helper — and the SAME pricing inputs — the Cart page totals
    // with, so the agent never has to do qty × price arithmetic to answer
    // "what's my total?" off this page. Omitting `pricing` here would leave
    // this readable holding the PRE-discount total the moment applyPromoCode
    // fires, which is exactly the number the seeded procedure tells the agent
    // to confirm in bold.
    const pricing: CartPricing = {
      club: BOOKSTORE_CLUB,
      promoCode: data.promoCode ?? undefined,
      storeCreditCents: data.storeCreditCents,
    };
    const { itemCount, subtotalCents, discountCents, totalCents } = cartTotals(
      data.books,
      data.cart,
      pricing,
    );
    return JSON.stringify({
      lines: data.cart.map((line) => {
        const book = byId.get(line.bookId);
        return {
          title: book?.title ?? line.bookId,
          qty: line.qty,
          price: book ? formatUsd(book.priceCents) : undefined,
        };
      }),
      item_count: itemCount,
      subtotal: formatUsd(subtotalCents),
      discount: formatUsd(discountCents),
      total: formatUsd(totalCents),
      promo_code: data.promoCode,
      deliver_by: data.deliverBy,
      orders_placed: data.orders.map((o) => ({
        order_id: o.id,
        total: formatUsd(o.totalCents),
        // The only card datum that exists anywhere past the CheckoutCard's own
        // state. Never a full number.
        card_last4: o.last4,
      })),
    });
    // Memoized on `data.cartSignature`, the store's churn guard, and NOT on
    // `data.cart` / `data.orders` themselves: keying on the cart directly would
    // rewrite the agent's context on every add-to-cart highlight tick. The
    // signature changes exactly when cart or order identity changes — including
    // the qty and line changes the totals above are derived from.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.cartSignature, byId]);

  useAgentContext({
    description:
      "The shopper's current cart and the orders they have already placed in this session, readable from any page. An order records only the last four digits of the card — you never have access to a full card number.",
    value: cartSummary,
  });

  // ── Beat 5: the shopper's standing book club procedure ────────────────────
  // Hoisted OUT of the dep array on purpose. A call expression inside the deps
  // array trips react-hooks/exhaustive-deps, and lint must stay green with
  // only the one pre-existing disable (on the cart readable, above). As a
  // plain day string it is also a stable memo key: it moves when the calendar
  // day does and not once per render. `localCalendarDay()` — never a bare
  // `new Date()` — because `nextMeetingISO` is UTC-only: a wall-clock date
  // would give a presenter west of UTC the wrong meeting day.
  const nextMeeting = nextMeetingISO(
    BOOKSTORE_CLUB.meetsOnWeekday,
    localCalendarDay(),
  );

  const clubContext = useMemo(() => {
    const pair = data.books.filter(
      (b) => b.workId === BOOKSTORE_CLUB.pickWorkId,
    );
    const hardcover = pair.find((b) => b.format === "hardcover");
    const paperback = pair.find((b) => b.format === "paperback");
    return JSON.stringify({
      club: BOOKSTORE_CLUB.name,
      pick: {
        title: pair[0]?.title,
        work_id: BOOKSTORE_CLUB.pickWorkId,
        hardcover_book_id: hardcover?.id,
        paperback_book_id: paperback?.id,
      },
      promo_code: BOOKSTORE_CLUB.promoCode,
      club_reads: "paperback",
      next_meeting: nextMeeting,
    });
  }, [data.books, nextMeeting]);

  useAgentContext({
    description:
      "The shopper's book club: its name, this month's pick with the book id of each edition, the club's discount code, the edition the club reads, and the date of the next meeting.",
    value: clubContext,
  });

  // ── Beat 1: give the agent a face ─────────────────────────────────────────
  // A `useComponent`, deliberately NOT a `useFrontendTool` render: only a
  // registered component replays from thread history, which is beat 2.
  useComponent(
    {
      name: "showBooks",
      description:
        "Show a row of books as real cover cards. Use this for ANY answer that " +
        "names two or more books — never write a markdown table or a bulleted " +
        "list of titles — EXCEPT a personalized recommendation for this shopper, " +
        "which goes through recommendBooks instead. Pass the book ids from the " +
        "catalog context. Always " +
        "write one or two sentences of prose alongside the cards: a row of " +
        "covers with no words reads as a glitch.",
      parameters: z.object({
        heading: z
          .string()
          .describe('A short heading, e.g. "New in translated fiction".'),
        bookIds: z
          .array(z.string())
          .describe("Catalog book ids, in the order you want them shown."),
      }),
      // The render receives the parsed args DIRECTLY (rule 2). During streaming
      // the parse is partial, so `bookIds` may still be undefined (rule 4).
      render: ({ heading, bookIds }) => {
        const books = (bookIds ?? [])
          .map((id) => byId.get(id))
          .filter((b): b is Book => b !== undefined);

        if (books.length === 0) {
          return (
            <div className="rounded-md border border-dashed border-hairline p-3 text-sm text-ink-muted">
              No books in the catalog match those ids.
            </div>
          );
        }

        return (
          <div className="flex flex-col gap-2">
            {heading ? (
              <div className="text-sm font-semibold text-ink">{heading}</div>
            ) : null}
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
              {books.map((book) => (
                <BookCard
                  key={book.id}
                  book={book}
                  href={skinHref(bookPath(book.slug))}
                  highlighted={data.lastAddedId === book.id}
                />
              ))}
            </div>
          </div>
        );
      },
    },
    [byId, data.lastAddedId, skinHref],
  );

  // ── Beat 4: long-term memory, with the "why" surfaced ─────────────────────
  // `RecommendationCard` calls `useBookstoreHref()` itself, so no href is
  // threaded into it here.
  useComponent(
    {
      name: "recommendBooks",
      description:
        "Recommend books, having FIRST called recall_memory. Pass the " +
        "preference you recalled in `note`, in a remembering voice — 'You skip " +
        "hardcovers and cap a book at $20, so —' — and give every pick a " +
        "one-line reason. If you recalled nothing, say so plainly in `note` " +
        "and recommend generally. The note is displayed to the shopper, so it " +
        "is how they learn what you remembered.",
      parameters: z.object({
        note: z
          .string()
          .describe(
            "The preference you recalled and applied, in your own voice. Required — this is what makes the recall visible.",
          ),
        picks: z
          .array(
            z.object({
              bookId: z.string(),
              reason: z
                .string()
                .describe("One line on why this book, for this shopper."),
            }),
          )
          .describe("Two to four books, best first."),
      }),
      render: ({ note, picks }) => {
        const resolved = (picks ?? []).flatMap((pick) => {
          const book = byId.get(pick.bookId);
          return book ? [{ book, reason: pick.reason }] : [];
        });

        if (resolved.length === 0) {
          return (
            <div className="rounded-md border border-dashed border-hairline p-3 text-sm text-ink-muted">
              No books in the catalog match those ids.
            </div>
          );
        }
        return (
          <RecommendationCard
            note={note}
            picks={resolved}
            highlightedBookId={data.lastAddedId}
          />
        );
      },
    },
    // `data.lastAddedId` is a plain string, so — unlike `byId`, whose Map
    // stringifies to a constant `{}` — it produces a dep key that actually
    // changes. That is what makes the add-to-cart ring appear and then clear on
    // these cards.
    [byId, data.lastAddedId],
  );

  // ── The cart write, with its visible affordance ───────────────────────────
  useFrontendTool(
    {
      name: "addToCart",
      description:
        "Add a book to the shopper's cart by catalog id. Adding the same book " +
        "again increases its quantity. Confirm in one short sentence naming " +
        "the title and the price.",
      parameters: z.object({
        bookId: z.string(),
        qty: z.number().int().min(1).max(9).optional(),
      }),
      handler: async ({ bookId, qty }) => {
        // The LIVE store, through the ref — not `data` off the closure. See the
        // deps array below: a `data.addToCart` dep cannot re-register this tool,
        // so the closure would keep writing into the FIRST shopper's store.
        const store = dataRef.current;
        // `byId` is seed-derived and immutable, so reading it from the closure is
        // safe even though the dep array below cannot refresh it.
        const book = byId.get(bookId);
        // Return a sentence rather than throwing: the agent reads this back, and
        // a refusal it can narrate is better than a tool error it cannot.
        if (!book) return `No book in the catalog has the id "${bookId}".`;
        store.addToCart(bookId, qty ?? 1);
        return `Added ${book.title} (${formatUsd(book.priceCents)}) to the cart.`;
      },
      // Keyed off `result`, never `status` (rule 3): on replay the recorded
      // result is what comes back, so this renders the same sentence when the
      // thread is reopened.
      render: ({ result }) => (
        <div className="rounded-md border border-hairline bg-surface px-3 py-2 text-sm text-ink-muted">
          {typeof result === "string" && result.length > 0
            ? result
            : "Adding to your cart…"}
        </div>
      ),
    },
    // DELIBERATELY EMPTY, and paired with `dataRef.current` in the handler.
    // `useFrontendTool` keys its registration effect on `JSON.stringify(deps)`,
    // so a `Map` or a function dep is not a dep at all: `[byId, data.addToCart]`
    // stringifies to the CONSTANT "[{},null]" and can never re-register the tool.
    // The handler would then keep the `data.addToCart` captured on the first
    // commit forever — and the shopper's store changes at least twice per demo
    // (hydration flips the server snapshot to localStorage; beat 4 switches
    // persona) without remounting this component, so the agent would write into
    // the PREVIOUS shopper's store and narrate a success that never landed. The
    // live store must therefore come from `dataRef.current`.
    [],
  );

  // ── Beat 5, step 2 of 4: swap a cart line for another edition ─────────────
  useFrontendTool(
    {
      name: "swapEdition",
      description:
        "Replace a cart line with a different EDITION of the same book (e.g. " +
        "hardcover → paperback). Both ids must be editions of one work; the " +
        "club readable gives you both ids for the club's pick. Not for adding " +
        "a different book — use addToCart.",
      parameters: z.object({
        fromBookId: z.string(),
        toBookId: z.string(),
      }),
      handler: async ({ fromBookId, toBookId }) => {
        // The LIVE store, through the ref — see addToCart's dep-array comment.
        const result = dataRef.current.swapEdition(fromBookId, toBookId);
        if (!result.ok) {
          return result.reason ?? "Could not swap the edition.";
        }
        // `byId` is seed-derived and immutable, so reading it from the closure
        // is safe even though the dep array below cannot refresh it.
        const toBook = byId.get(toBookId);
        return toBook
          ? `Swapped to ${toBook.title} (${toBook.format}).`
          : "Swapped the edition.";
      },
      // Keyed off `result`, never `status` (rule 3).
      render: ({ result }) => (
        <div className="rounded-md border border-hairline bg-surface px-3 py-2 text-sm text-ink-muted">
          {typeof result === "string" && result.length > 0
            ? result
            : "Swapping the edition…"}
        </div>
      ),
    },
    // DELIBERATELY EMPTY — a write tool, same reasoning as addToCart above:
    // deps are JSON.stringify'd, so a function/closure dep can never re-register
    // this tool, and the live store must come from `dataRef.current` instead.
    [],
  );

  // ── Beat 5, step 3 of 4: apply the club's discount code ───────────────────
  useFrontendTool(
    {
      name: "applyPromoCode",
      description:
        "Apply a discount code to the cart. The club's code is in the club " +
        "readable. This is NOT store credit.",
      parameters: z.object({
        code: z.string(),
      }),
      handler: async ({ code }) => {
        const result = dataRef.current.applyPromoCode(code);
        // `result.reason` echoes the SHOPPER'S ATTEMPT (use-data.ts), never the
        // real code — so relaying it verbatim here cannot leak the club's code.
        if (!result.ok) {
          return result.reason ?? "Could not apply that code.";
        }
        return `Applied promo code ${code} to the cart.`;
      },
      render: ({ result }) => (
        <div className="rounded-md border border-hairline bg-surface px-3 py-2 text-sm text-ink-muted">
          {typeof result === "string" && result.length > 0
            ? result
            : "Applying the code…"}
        </div>
      ),
    },
    // DELIBERATELY EMPTY — same reasoning as addToCart above.
    [],
  );

  // ── Beat 5, step 4 of 4: set the delivery-by date ──────────────────────────
  useFrontendTool(
    {
      name: "setDeliveryBy",
      description:
        "Set the date the order must arrive by, as YYYY-MM-DD. Use the club's " +
        "next meeting date from the club readable. This is not a reminder.",
      parameters: z.object({
        isoDate: z.string(),
      }),
      handler: async ({ isoDate }) => {
        const result = dataRef.current.setDeliveryBy(isoDate);
        if (!result.ok) {
          return result.reason ?? "Could not set the delivery date.";
        }
        return `Delivery set for ${isoDate}.`;
      },
      render: ({ result }) => (
        <div className="rounded-md border border-hairline bg-surface px-3 py-2 text-sm text-ink-muted">
          {typeof result === "string" && result.length > 0
            ? result
            : "Setting the delivery date…"}
        </div>
      ),
    },
    // DELIBERATELY EMPTY — same reasoning as addToCart above.
    [],
  );

  // ── Distractor for addToCart ───────────────────────────────────────────────
  useFrontendTool(
    {
      name: "addToWishlist",
      description:
        "Save a book for later. Does NOT add it to the cart and does NOT " +
        "affect the total.",
      parameters: z.object({
        bookId: z.string(),
      }),
      handler: async ({ bookId }) => {
        const result = dataRef.current.addToWishlist(bookId);
        if (!result.ok) {
          return result.reason ?? "Could not save that book.";
        }
        const book = byId.get(bookId);
        return book
          ? `Saved ${book.title} for later.`
          : "Saved the book for later.";
      },
      render: ({ result }) => (
        <div className="rounded-md border border-hairline bg-surface px-3 py-2 text-sm text-ink-muted">
          {typeof result === "string" && result.length > 0
            ? result
            : "Saving for later…"}
        </div>
      ),
    },
    // DELIBERATELY EMPTY — same reasoning as addToCart above.
    [],
  );

  // ── Distractor for setDeliveryBy ───────────────────────────────────────────
  useFrontendTool(
    {
      name: "setReminder",
      description:
        "Remind the shopper about a book on a date. Does NOT affect delivery.",
      parameters: z.object({
        bookId: z.string(),
        isoDate: z.string(),
      }),
      handler: async ({ bookId, isoDate }) => {
        const result = dataRef.current.setReminder(bookId, isoDate);
        if (!result.ok) {
          return result.reason ?? "Could not set that reminder.";
        }
        const book = byId.get(bookId);
        return book
          ? `Set a reminder for ${book.title} on ${isoDate}.`
          : `Set a reminder for ${isoDate}.`;
      },
      render: ({ result }) => (
        <div className="rounded-md border border-hairline bg-surface px-3 py-2 text-sm text-ink-muted">
          {typeof result === "string" && result.length > 0
            ? result
            : "Setting a reminder…"}
        </div>
      ),
    },
    // DELIBERATELY EMPTY — same reasoning as addToCart above.
    [],
  );

  // ── Distractor for applyPromoCode ──────────────────────────────────────────
  useFrontendTool(
    {
      name: "applyStoreCredit",
      description:
        "Apply store credit to the cart. This is NOT a promo code and is NOT " +
        "the book club discount.",
      parameters: z.object({
        cents: z.number().int().min(0),
      }),
      handler: async ({ cents }) => {
        const result = dataRef.current.applyStoreCredit(cents);
        if (!result.ok) {
          return result.reason ?? "Could not apply store credit.";
        }
        return `Applied ${formatUsd(cents)} in store credit.`;
      },
      render: ({ result }) => (
        <div className="rounded-md border border-hairline bg-surface px-3 py-2 text-sm text-ink-muted">
          {typeof result === "string" && result.length > 0
            ? result
            : "Applying store credit…"}
        </div>
      ),
    },
    // DELIBERATELY EMPTY — same reasoning as addToCart above.
    [],
  );

  // ── Plain navigation to one book ──────────────────────────────────────────
  useFrontendTool(
    {
      name: "openBook",
      description:
        "Open one book's detail page. Use when the shopper asks to see or read " +
        "more about a specific book. To change what the SHELF shows, use " +
        "browseWithFilters instead.",
      parameters: z.object({
        slug: z.string().describe("The book's slug from the catalog context."),
      }),
      handler: async ({ slug }) => {
        const book = dataRef.current.books.find((b) => b.slug === slug);
        if (!book) return `No book is filed under "${slug}".`;
        router.push(skinHref(bookPath(slug)));
        return `Opened ${book.title}.`;
      },
      render: ({ result }) => (
        <div className="rounded-md border border-hairline bg-surface px-3 py-2 text-sm text-ink-muted">
          {typeof result === "string" && result.length > 0
            ? result
            : "Opening the book…"}
        </div>
      ),
    },
    // DELIBERATELY EMPTY, same reason as `addToCart`: deps are JSON-stringified,
    // so `[router, data.books, skinHref]` yields a key that never changes and
    // cannot re-register the tool — while stringifying the whole 25-book catalog
    // on every render of this component. The live catalog comes from
    // `dataRef.current.books`; `router` and `skinHref` are stable by construction.
    [],
  );

  // ── Beat 3c: navigate with levers, confirming them first ──────────────────
  useHumanInTheLoop(
    {
      name: "browseWithFilters",
      description:
        "Change what the shelf shows by applying real filters and a sort to the " +
        "Browse page. The shopper confirms first and sees exactly which levers " +
        "you are setting. Use this for any 'show me…' request about a group of " +
        "books — do NOT just describe the filters, and do not use openBook for a " +
        "group. Pass a price cap in whole dollars.",
      parameters: z.object({
        genre: z
          .enum([
            "literary",
            "translated",
            "scifi",
            "mystery",
            "history",
            "poetry",
          ])
          .optional(),
        format: z.enum(["paperback", "hardcover", "ebook"]).optional(),
        maxDollars: z
          .number()
          .positive()
          .optional()
          .describe("Price cap in whole dollars, e.g. 20 for 'under $20'."),
        sort: z
          .enum(["price_asc", "price_desc", "rating_desc", "newest"])
          .optional(),
      }),
      render: ({ args, status, respond, result, toolCallId }) => {
        const maxDollars = args?.maxDollars as number | undefined;
        const query: BookQuery = {
          genre: args?.genre as Genre | undefined,
          format: args?.format as Format | undefined,
          maxCents:
            maxDollars !== undefined ? Math.round(maxDollars * 100) : undefined,
          sort: args?.sort as SortKey | undefined,
        };

        // 1. This session already answered it → show what we recorded, in the
        //    same chip. Consulted BEFORE the replayed result because a reopened
        //    thread may replay an answered call with no result at all, which
        //    would otherwise fall through to the indeterminate placeholder.
        const answered = answeredNavigations.get(toolCallId);
        if (answered) {
          return (
            <div className="rounded-md border border-hairline bg-surface px-3 py-2 text-sm text-ink-muted">
              {answered.summary}
            </div>
          );
        }

        // 2. Otherwise the replay path, keyed off the recorded result — never off
        //    status (rule 3). A reopened thread replays this call with its stored
        //    result and no live status transition.
        if (typeof result === "string" && result.length > 0) {
          return (
            <div className="rounded-md border border-hairline bg-surface px-3 py-2 text-sm text-ink-muted">
              {result}
            </div>
          );
        }

        if (status === ToolCallStatus.Executing && respond) {
          return (
            <NavigateConfirmCard
              query={query}
              onConfirm={() => {
                // Through `bookQueryToParams` + `browseTarget`, exactly as
                // browse.tsx's `apply` does — never a hand-assembled query
                // string. Routing the push through the SAME serializer the page
                // parses back with (`parseBookQuery`) is the whole beat: the
                // agent's navigation round-trips into the identical `BookQuery`
                // the shelf then reads off the URL. A hand-rolled string also
                // reintroduces the `/bookstore` literal the lock forbids.
                const params = bookQueryToParams(query);
                router.push(browseTarget(skinHref, params.toString()));
                // Speak back the SAME description the card showed, so the agent
                // cannot narrate a different set of filters than it applied — and
                // record that same line so a replay without a result still says
                // which levers were set.
                const summary = `Applied to the shelf — ${describeQuery(query).join("; ")}.`;
                answeredNavigations.set(toolCallId, { summary });
                void respond(summary);
              }}
              onCancel={() => {
                const summary = "The shopper declined the filter change.";
                answeredNavigations.set(toolCallId, { summary });
                void respond(summary);
              }}
            />
          );
        }

        return (
          <div className="rounded-md border border-hairline bg-surface px-3 py-2 text-sm text-ink-muted">
            Updating the shelf…
          </div>
        );
      },
    },
    [router, skinHref],
  );

  // ── Beat 3a: take payment without ever seeing the card ────────────────────
  useHumanInTheLoop(
    {
      name: "openCheckout",
      description:
        "Open the checkout form in the chat so the shopper can pay for what is " +
        "in their cart. Call this IMMEDIATELY when they want to buy. NEVER ask " +
        "for a card number, expiry or security code — you cannot see them and " +
        "must never request them. Do not ask which items first; the cart is the " +
        "order.",
      parameters: z.object({}),
      render: ({ status, respond, result, toolCallId }) => {
        // Read through the REF, never off `data` — see the empty deps array
        // below for why this tool must not take a dep on the cart.
        const store = dataRef.current;
        // SAME pricing inputs `placeOrder` (use-data.ts) applies when it
        // commits the order, so this form's total always agrees with the
        // receipt `placeOrder` then produces — never the pre-discount figure.
        const pricing: CartPricing = {
          club: BOOKSTORE_CLUB,
          promoCode: store.promoCode ?? undefined,
          storeCreditCents: store.storeCreditCents,
        };
        const { itemCount, totalCents } = cartTotals(
          store.books,
          store.cart,
          pricing,
        );

        // 1. This session already answered it → show the receipt we recorded.
        //    Consulted BEFORE the replayed result because a reopened thread may
        //    replay this call with no result at all (see answeredCheckouts).
        const answered = answeredCheckouts.get(toolCallId);
        if (answered) {
          return (
            <CheckoutCard
              mode="receipt"
              orderId={answered.orderId}
              itemCount={answered.itemCount}
              totalCents={answered.totalCents}
              last4={answered.last4}
            />
          );
        }

        // 2. Otherwise re-derive from the replayed RESULT — never from status.
        //    The result string is the one place the outcome is durable, so parse
        //    the non-secret facts back out of it.
        if (typeof result === "string" && result.length > 0) {
          const order = /Order #(\d+)/.exec(result)?.[1];
          const last4 = /•{4} (\d{4})/.exec(result)?.[1];
          const items = Number(/(\d+) items?/.exec(result)?.[1] ?? 0);
          const total = /\$([\d.]+)/.exec(result)?.[1];
          if (order && last4) {
            return (
              <CheckoutCard
                mode="receipt"
                orderId={order}
                itemCount={items}
                totalCents={total ? Math.round(Number(total) * 100) : 0}
                last4={last4}
              />
            );
          }
          return (
            <div className="rounded-md border border-hairline bg-surface px-3 py-2 text-sm text-ink-muted">
              {result}
            </div>
          );
        }

        if (status === ToolCallStatus.Executing && respond) {
          if (itemCount === 0) {
            return (
              <div className="rounded-md border border-hairline bg-surface p-3 text-sm text-ink-muted">
                The cart is empty.
                <button
                  type="button"
                  className="ml-2 underline"
                  onClick={() =>
                    void respond("The cart is empty — nothing to pay for yet.")
                  }
                >
                  Dismiss
                </button>
              </div>
            );
          }
          return (
            <CheckoutCard
              mode="form"
              itemCount={itemCount}
              totalCents={totalCents}
              onSubmit={(last4) => {
                // `placeOrder` returns the order it created, so the summary names
                // the same order that was committed.
                const order = dataRef.current.placeOrder(last4);
                // BOTH figures come off the COMMITTED order, never one from the
                // order and one from the render-time `dataRef` read: if the cart
                // changed while this form was open those two moments disagree, and
                // both appear in the responded summary.
                const orderedItems = order.lines.reduce((n, l) => n + l.qty, 0);
                answeredCheckouts.set(toolCallId, {
                  orderId: order.id,
                  itemCount: orderedItems,
                  totalCents: order.totalCents,
                  last4,
                });
                // THE ONLY THING THE AGENT EVER LEARNS ABOUT THE CARD.
                void respond(
                  `Order #${order.id} placed — ${orderedItems} item${
                    orderedItems === 1 ? "" : "s"
                  }, ${formatUsd(order.totalCents)} (•••• ${last4}).`,
                );
              }}
              onCancel={() =>
                void respond("The shopper closed the checkout without paying.")
              }
            />
          );
        }

        return (
          <div className="rounded-md border border-hairline bg-surface px-3 py-2 text-sm text-ink-muted">
            Opening checkout…
          </div>
        );
      },
    },
    // DELIBERATELY EMPTY, and paired with `dataRef.current` above. These hooks
    // unregister and re-register whenever their deps change, and this tool
    // WRITES: `onSubmit` calls `placeOrder`, which mutates the cart. A
    // `data.cart` dep would therefore tear the tool down IN THE MIDDLE OF ITS
    // OWN CALL, losing the pending `respond()` and failing the thread with
    // "Tool result is missing for tool call". The ref is how the render still
    // sees live cart state without taking that dep.
    [],
  );

  return null;
}
