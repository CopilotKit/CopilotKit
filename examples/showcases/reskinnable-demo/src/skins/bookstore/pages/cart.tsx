"use client";

import Link from "next/link";
import { useAgentContext } from "@copilotkit/react-core/v2";
import { useSkinData } from "@/shell/skin-provider";
import { useBookstoreHref } from "@/skins/bookstore/href";
import type {
  Book,
  BookstoreData,
  CartLine,
} from "@/skins/bookstore/data/types";
import { cartTotals, formatUsd } from "@/skins/bookstore/data/query";
import { BOOKSTORE_CLUB } from "@/skins/bookstore/data/club";
import { BookCover } from "@/skins/bookstore/components/book-cover";
import { cn } from "@/lib/utils";

/**
 * Splits the cart's combined `discountCents` between the club percentage and
 * store credit for HONEST labelling.
 *
 * `cartTotals` returns one scalar `discountCents`, so rendering it under a
 * single label mis-attributes the OTHER source whenever both apply — the
 * combined case, reachable exactly when the `applyStoreCredit` distractor
 * fires alongside an active club code. `clubPart` recomputes the discount
 * with the club alone (no store credit in `pricing`) and clamps it at
 * `subtotalCents`; `creditPart` is whatever of the real, already-floored
 * `discountCents` remains. Both are always `>= 0` and `clubPart + creditPart
 * === discountCents` exactly: `clubPart` is `min(subtotalCents, X)` where `X`
 * is monotonically <= the combined pre-clamp sum, so `clubPart` never exceeds
 * `discountCents` (itself `min(subtotalCents, combined sum)`).
 *
 * Exported so the five cases (club only, credit only, both, neither, credit
 * exceeding the subtotal) are covered without mounting the page component.
 */
export function splitCartDiscount(
  books: readonly Book[],
  cart: readonly CartLine[],
  subtotalCents: number,
  discountCents: number,
  promoCode: string | undefined,
): { clubPart: number; creditPart: number } {
  const clubPart = Math.min(
    subtotalCents,
    cartTotals(books, cart, { club: BOOKSTORE_CLUB, promoCode }).discountCents,
  );
  return { clubPart, creditPart: discountCents - clubPart };
}

export function CartPage() {
  const bookstoreHref = useBookstoreHref();
  const data = useSkinData<BookstoreData>();
  const { itemCount, subtotalCents, discountCents, totalCents } = cartTotals(
    data.books,
    data.cart,
    {
      club: BOOKSTORE_CLUB,
      promoCode: data.promoCode ?? undefined,
      storeCreditCents: data.storeCreditCents,
    },
  );
  const { clubPart: clubDiscountCents, creditPart: creditDiscountCents } =
    splitCartDiscount(
      data.books,
      data.cart,
      subtotalCents,
      discountCents,
      data.promoCode ?? undefined,
    );

  // A line whose book has left the catalog is dropped rather than rendered
  // broken — a stale `localStorage` cart from an older seed must not be able
  // to crash this page.
  const lines = data.cart.flatMap((line) => {
    const book = data.books.find((b) => b.id === line.bookId);
    return book ? [{ line, book }] : [];
  });

  const wishlistCount = data.wishlist.length;
  const reminderCount = data.reminders.length;

  useAgentContext({
    description:
      "What is visibly on the Cart page: the lines in the cart with quantities and prices, the subtotal, discount and total, the applied promo code, the delivery date, the orders already placed in this session, and the wishlist/reminder distractor counts.",
    value: JSON.stringify({
      page: "cart",
      item_count: itemCount,
      subtotal: formatUsd(subtotalCents),
      discount: formatUsd(discountCents),
      total: formatUsd(totalCents),
      promo_code: data.promoCode,
      deliver_by: data.deliverBy,
      wishlist_count: wishlistCount,
      reminder_count: reminderCount,
      lines: lines.map(({ line, book }) => ({
        title: book.title,
        author: book.author,
        qty: line.qty,
        price: formatUsd(book.priceCents),
      })),
      orders: data.orders.map((order) => ({
        order_id: order.id,
        total: formatUsd(order.totalCents),
        // Only the last four digits ever leave CheckoutCard — never the full
        // card number — so this readable can only ever echo that same shape.
        card_last4: order.last4,
        items: order.lines.reduce((sum, l) => sum + l.qty, 0),
      })),
    }),
  });

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="bookstore-display text-2xl font-bold tracking-tight text-ink">
          Your cart
        </h1>
        {data.deliverBy ? (
          <span className="rounded-full bg-brand-soft px-3 py-1 text-xs font-semibold text-brand">
            Deliver by {data.deliverBy}
          </span>
        ) : null}
      </div>

      {lines.length === 0 ? (
        <div className="rounded-md border border-dashed border-hairline p-8 text-center text-sm text-ink-muted">
          Your cart is empty.{" "}
          <Link href={bookstoreHref()} className="text-brand underline">
            Back to the shelf
          </Link>
        </div>
      ) : (
        <>
          <ul className="flex flex-col gap-2">
            {lines.map(({ line, book }) => (
              <li
                key={book.id}
                className={cn(
                  "flex items-center gap-3 rounded-md border border-hairline bg-surface p-3 transition-shadow",
                  // The add-to-cart affordance, on the surface where the change
                  // actually happened.
                  data.lastAddedId === book.id && "ring-2 ring-brand",
                )}
              >
                <BookCover book={book} className="w-12 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-ink">
                    {book.title}
                  </div>
                  <div className="truncate text-xs text-ink-muted">
                    {book.author} · {book.format}
                  </div>
                </div>
                <div className="text-sm text-ink-muted">×{line.qty}</div>
                <div className="w-16 text-right text-sm font-semibold text-ink">
                  {formatUsd(book.priceCents * line.qty)}
                </div>
                <button
                  type="button"
                  onClick={() => data.removeFromCart(book.id)}
                  aria-label={`Remove ${book.title}`}
                  className="text-xs text-ink-muted underline hover:text-negative"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>

          <div className="mt-4 flex flex-col gap-1 border-t border-hairline pt-3">
            <div className="flex items-baseline justify-between text-sm text-ink-muted">
              <span>
                Subtotal · {itemCount} {itemCount === 1 ? "item" : "items"}
              </span>
              <span>{formatUsd(subtotalCents)}</span>
            </div>
            {clubDiscountCents > 0 ? (
              <div className="flex items-baseline justify-between text-sm text-positive">
                <span>
                  {BOOKSTORE_CLUB.name} · {BOOKSTORE_CLUB.promoCode}
                </span>
                <span>-{formatUsd(clubDiscountCents)}</span>
              </div>
            ) : null}
            {creditDiscountCents > 0 ? (
              <div className="flex items-baseline justify-between text-sm text-positive">
                <span>Store credit</span>
                <span>-{formatUsd(creditDiscountCents)}</span>
              </div>
            ) : null}
            <div className="flex items-baseline justify-between pt-1">
              <span className="text-sm font-semibold text-ink">Total</span>
              <span className="bookstore-display text-xl font-bold text-ink">
                {formatUsd(totalCents)}
              </span>
            </div>
          </div>

          {/* No Checkout button by design. Checkout is the agent's demo beat:
              it opens a CheckoutCard in the chat that the shopper types their
              card into, so the digits never reach the model. A parallel
              in-page checkout form would invite the audience to compare the
              two, which is not a comparison this demo needs. */}
          <p className="mt-3 text-xs text-ink-muted">
            Ask the assistant to check out when you&apos;re ready.
          </p>
        </>
      )}

      {data.orders.length > 0 ? (
        <section className="mt-8">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-muted">
            Orders
          </h2>
          <ul className="flex flex-col gap-2">
            {data.orders.map((order) => (
              <li
                key={order.id}
                className="flex items-center justify-between rounded-md border border-hairline bg-surface-muted p-3 text-sm"
              >
                <span className="font-semibold text-ink">
                  Order #{order.id}
                </span>
                <span className="text-ink-muted">
                  {order.lines.reduce((sum, l) => sum + l.qty, 0)} items ·{" "}
                  {formatUsd(order.totalCents)} · •••• {order.last4}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {wishlistCount > 0 || reminderCount > 0 ? (
        <p className="mt-3 text-xs text-ink-muted">
          {[
            wishlistCount > 0
              ? `${wishlistCount} ${wishlistCount === 1 ? "book" : "books"} saved for later`
              : null,
            reminderCount > 0
              ? `${reminderCount} ${reminderCount === 1 ? "reminder" : "reminders"} set`
              : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      ) : null}
    </div>
  );
}
