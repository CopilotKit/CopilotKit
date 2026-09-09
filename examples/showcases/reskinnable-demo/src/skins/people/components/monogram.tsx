"use client";

import { cn } from "@/lib/utils";
import { initials, monogramHue } from "../data/derive";

/**
 * A person's monogram tile.
 *
 * Rowan uses no photographs — a demo roster of stock headshots reads as fake
 * the moment anyone looks twice, and a real one is not ours to ship. Instead
 * every person gets a tile in a colour deterministically derived from their
 * name (see `monogramHue`), so they keep the same colour on the roster, on the
 * ladder, in the queue, and inside chat gen-UI. That consistency is what turns
 * a list of rows into a set of recognisable faces.
 *
 * The hue is applied at low saturation and high lightness on purpose. The
 * chrome is plum; if seventeen monograms were fully saturated they would win
 * every screen they appear on.
 */
export function Monogram({
  name,
  size = "md",
  className,
  ring,
}: {
  name: string;
  size?: "xs" | "sm" | "md" | "lg";
  className?: string;
  /** Draw an emphasis ring — used for the person a tool just acted on. */
  ring?: "brand" | "negative" | null;
}) {
  const hue = monogramHue(name);
  const dimensions = {
    xs: "h-6 w-6 text-[0.6rem]",
    sm: "h-8 w-8 text-[0.7rem]",
    md: "h-10 w-10 text-xs",
    lg: "h-14 w-14 text-base",
  }[size];

  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold tracking-wide",
        dimensions,
        ring === "brand" &&
          "ring-2 ring-brand ring-offset-2 ring-offset-surface",
        ring === "negative" &&
          "ring-2 ring-negative ring-offset-2 ring-offset-surface",
        className,
      )}
      style={{
        backgroundColor: `hsl(${hue} 44% 92%)`,
        color: `hsl(${hue} 52% 28%)`,
      }}
    >
      {initials(name)}
    </span>
  );
}
