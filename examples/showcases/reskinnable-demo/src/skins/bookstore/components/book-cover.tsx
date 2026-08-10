"use client";

import type { Book } from "@/skins/bookstore/data/types";
import { cn } from "@/lib/utils";

/**
 * Generated typographic covers — the skin's entire visual identity.
 *
 * Deliberately NOT images. 24 sourced cover scans would be a licensing problem,
 * would not reskin when the theme changes, and would read as stock photography
 * in a demo whose whole argument is that the UI belongs to the product. A
 * generated cover is on-brand by construction.
 *
 * The tints are literal colour values rather than theme tokens on purpose: a
 * shelf whose every spine is --brand reads as one book repeated. They are
 * chosen to sit inside the warm-paper palette, so a future reskin of this skin
 * changes the chrome and leaves the shelf coherent.
 */
export const COVER_TINTS: readonly { bg: string; ink: string }[] =
  Object.freeze([
    { bg: "#7a2e2e", ink: "#f7ece4" }, // oxblood
    { bg: "#2f4858", ink: "#eef3f5" }, // slate blue
    { bg: "#4a5d3a", ink: "#eff3e9" }, // olive
    { bg: "#8a5a2b", ink: "#f8efe3" }, // tan leather
    { bg: "#3c3550", ink: "#efecf6" }, // plum
    { bg: "#1c1a17", ink: "#f3ede2" }, // ink black
  ]);

/**
 * Fit the title by character count. A 4-word literary title and a one-word one
 * cannot share a size without one of them either overflowing or looking lost.
 */
function titleSizePx(title: string): number {
  if (title.length <= 10) return 22;
  if (title.length <= 18) return 18;
  if (title.length <= 28) return 15;
  return 13;
}

export function BookCover({
  book,
  className,
}: {
  book: Book;
  className?: string;
}) {
  // Clamp rather than trust: `spineTint` is seed data today, but an out-of-range
  // index would otherwise read `undefined.bg` and crash the whole shelf.
  const tintIndex =
    Number.isInteger(book.spineTint) &&
    book.spineTint >= 0 &&
    book.spineTint < COVER_TINTS.length
      ? book.spineTint
      : 0;
  const tint = COVER_TINTS[tintIndex];
  const size = titleSizePx(book.title);

  return (
    <div
      role="img"
      aria-label={`${book.title} by ${book.author}`}
      data-tint={tintIndex}
      className={cn(
        "relative flex aspect-[2/3] w-full flex-col justify-between overflow-hidden p-3 shadow-soft",
        className,
      )}
      style={{ backgroundColor: tint.bg, color: tint.ink, borderRadius: 4 }}
    >
      {/* Spine shadow — the one gradient, and what stops the cover reading as a
          flat coloured rectangle (spec §12 risk 4). */}
      <div
        aria-hidden="true"
        className="absolute inset-y-0 left-0 w-2"
        style={{
          background:
            "linear-gradient(to right, rgba(0,0,0,0.28), rgba(0,0,0,0))",
        }}
      />
      <div
        data-title-size={size}
        className="bookstore-display pl-2 font-semibold leading-tight"
        style={{ fontSize: size }}
      >
        {book.title}
      </div>
      <div className="pl-2">
        <div
          aria-hidden="true"
          className="mb-1.5 h-px w-8"
          style={{ backgroundColor: tint.ink, opacity: 0.5 }}
        />
        <div className="text-[10px] font-medium uppercase tracking-[0.14em] opacity-85">
          {book.author}
        </div>
      </div>
    </div>
  );
}
