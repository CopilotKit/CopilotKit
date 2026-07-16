"use client";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import * as React from "react";
import { cn } from "@/lib/cn";

export const Popover = PopoverPrimitive.Root;

export const PopoverTrigger = PopoverPrimitive.Trigger;

export function PopoverContent({
  className,
  align = "center",
  sideOffset = 4,
  ...props
}: React.ComponentPropsWithRef<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        align={align}
        sideOffset={sideOffset}
        side="bottom"
        className={cn(
          "shell-docs-radius-surface z-50 origin-(--radix-popover-content-transform-origin) overflow-y-auto max-h-(--radix-popover-content-available-height) min-w-[240px] max-w-[98vw] border border-[var(--border)] bg-[var(--card)] p-2 text-sm text-[var(--foreground)] shadow-[var(--shadow-panel)] focus-visible:outline-none data-[state=closed]:animate-fd-popover-out data-[state=open]:animate-fd-popover-in",
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}

// Radix UI exports the close primitive as `Close`, NOT `PopoverClose`.
// The previous `PopoverPrimitive.PopoverClose` resolved to `undefined`
// at runtime, so any caller importing + rendering `<PopoverClose />`
// would have thrown a React "Element type is invalid" error. We don't
// have any callers today (this is a fresh shadcn scaffold from the
// fumadocs CLI), but ship the correct re-export so future callers
// don't trip the same wire.
export const PopoverClose = PopoverPrimitive.Close;
