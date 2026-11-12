"use client";

/**
 * ShadCN-flavoured Separator primitive — uses the (already-installed)
 * `@radix-ui/react-separator` accessibility primitive.
 */
import React from "react";
import * as SeparatorPrimitive from "@radix-ui/react-separator";

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
