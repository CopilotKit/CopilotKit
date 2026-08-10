"use client";

import Link from "next/link";
import { useAgentContext } from "@copilotkit/react-core/v2";
import { useSkinData } from "@/shell/skin-provider";
import { useBookstoreHref } from "@/skins/bookstore/href";
import type { BookstoreData } from "@/skins/bookstore/data/types";
import { cartTotals, formatUsd } from "@/skins/bookstore/data/query";
import { BookCover } from "@/skins/bookstore/components/book-cover";
import { cn } from "@/lib/utils";

export function CartPage() {
  const bookstoreHref = useBookstoreHref();
  const data = useSkinData<BookstoreData>();
  const { itemCount, totalCents } = cartTotals(data.books, data.cart);

  // A line whose book has left the catalog is dropped rather than rendered
  // broken — a stale `localStorage` cart from an older seed must not be able
  // to crash this page.
  const lines = data.cart.flatMap((line) => {
    const book = data.books.find((b) => b.id === line.bookId);
    return book ? [{ line, book }] : [];
  });

  useAgentContext({
    description:
      "What is visibly on the Cart page: the lines in the cart with quantities and prices, the total, and the orders already placed in this session.",
    value: JSON.stringify({
      page: "cart",
      item_count: itemCount,
      total: formatUsd(totalCents),
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
      <h1 className="bookstore-display mb-4 text-2xl font-bold tracking-tight text-ink">
        Your cart
      </h1>

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

          <div className="mt-4 flex items-baseline justify-between border-t border-hairline pt-3">
            <span className="text-sm text-ink-muted">
              {itemCount} {itemCount === 1 ? "item" : "items"}
            </span>
            <span className="bookstore-display text-xl font-bold text-ink">
              {formatUsd(totalCents)}
            </span>
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
    </div>
  );
}
