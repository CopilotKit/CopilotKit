"use client";

/**
 * ShadCN-flavoured Separator primitive.
 */
import React from "react";
import { Separator as SeparatorPrimitive } from "radix-ui";

export function Separator({
  className = "",
  orientation = "horizontal",
  decorative = true,
  ...props
}: React.ComponentPropsWithoutRef<typeof SeparatorPrimitive.Root>) {
  return (
    <SeparatorPrimitive.Root
      decorative={decorative}
      orientation={orientation}
      className={`shrink-0 bg-[var(--border)] ${
        orientation === "horizontal" ? "h-px w-full" : "h-full w-px"
      } ${className}`}
      {...props}
    />
  );
}
