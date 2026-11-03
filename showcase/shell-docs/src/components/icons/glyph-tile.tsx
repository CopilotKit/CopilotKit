import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * A glyph's tile on the stage's blue, glyph in white (`--glyph-tile`, deep
 * enough that white clears 3:1), as the navbar menus draw their glyphs.
 * Exported for Fumadocs' own menu cards, which draw the tile themselves and
 * take it through child selectors (layout-client.tsx).
 */
export const GLYPH_TILE =
  "border-white/50 bg-(image:--glyph-tile) text-white shadow-[0_2px_6px_rgb(76_92_214/0.3)] dark:border-white/15";

const SIZES = {
  sm: "size-7 rounded-md [&_svg]:size-4",
  md: "size-8 rounded-md [&_svg]:size-4",
  lg: "size-10 rounded-lg [&_svg]:size-5",
};

/**
 * The navbar menus' glyph tile, for anywhere a glyph heads a row or a card:
 * the menus, the playground's category rail and its demo window. Pass one
 * of the solid glyphs from `glyphs.tsx`.
 */
export function GlyphTile({
  size = "md",
  className,
  children,
}: {
  size?: keyof typeof SIZES;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex shrink-0 items-center justify-center border",
        GLYPH_TILE,
        SIZES[size],
        className,
      )}
    >
      {children}
    </span>
  );
}
