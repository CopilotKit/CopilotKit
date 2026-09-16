"use client";

import { cn } from "@/lib/utils";
import { initials, tileHue } from "../data/derive";

/**
 * A product's (or a customer's) tile.
 *
 * Bellwether uses no product photography — a demo catalog of stock imagery reads
 * as fake the moment anyone looks twice, and a real one is not ours to ship.
 * Instead every SKU gets a tile in a colour deterministically derived from its
 * name (see `tileHue`), so it keeps the same colour on the catalog, on the
 * ladder, in the order rows, and inside chat gen-UI. That consistency is what
 * turns a list of rows into a set of recognisable products.
 *
 * The hue is applied at low saturation and high lightness on purpose. The chrome
 * is ink blue and the one loud colour is the rose markdown accent; if fourteen
 * product tiles were fully saturated they would win every screen they appear on
 * and the markdown chips would stop meaning anything.
 *
 * `square` is the product variant (a swatch reads as a good), `round` the person
 * variant (a face does not).
 */
export function SkuTile({
  name,
  size = "md",
  shape = "square",
  className,
  ring,
}: {
  name: string;
  size?: "xs" | "sm" | "md" | "lg";
  shape?: "square" | "round";
  className?: string;
  /** Draw an emphasis ring — used for the SKU a tool just acted on. */
  ring?: "brand" | "negative" | "markdown" | null;
}) {
  const hue = tileHue(name);
  const dimensions = {
    xs: "h-6 w-6 text-[0.58rem]",
    sm: "h-8 w-8 text-[0.68rem]",
    md: "h-10 w-10 text-[0.72rem]",
    lg: "h-14 w-14 text-sm",
  }[size];

  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 select-none items-center justify-center font-semibold tracking-wide",
        shape === "round" ? "rounded-full" : "rounded-md",
        dimensions,
        ring === "brand" &&
          "ring-2 ring-brand ring-offset-2 ring-offset-surface",
        ring === "negative" &&
          "ring-2 ring-negative ring-offset-2 ring-offset-surface",
        ring === "markdown" &&
          "ring-2 ring-brand-violet ring-offset-2 ring-offset-surface",
        className,
      )}
      style={{
        backgroundColor: `hsl(${hue} 40% 92%)`,
        color: `hsl(${hue} 48% 28%)`,
      }}
    >
      {initials(name)}
    </span>
  );
}
