"use client";

import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";

import { cn } from "@/lib/utils";

const Tabs = TabsPrimitive.Root;

/**
 * Two visual flavours, selected per-`TabsList`:
 *  - "pill" (default): soft lilac track, white active chip with violet text.
 *  - "underline": borderless row with a violet underline under the active tab.
 * The variant is shared with descendant triggers via a tiny context so callers
 * only set it once on the list.
 */
type TabsVariant = "pill" | "underline";
const TabsVariantContext = React.createContext<TabsVariant>("pill");

const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List> & {
    variant?: TabsVariant;
  }
>(({ className, variant = "pill", ...props }, ref) => (
  <TabsVariantContext.Provider value={variant}>
    <TabsPrimitive.List
      ref={ref}
      className={cn(
        variant === "pill"
          ? "inline-flex h-11 items-center justify-center rounded-full bg-brand-soft/70 p-1 text-ink-muted dark:bg-brand-soft/40"
          : "inline-flex items-center justify-start gap-6 border-b border-hairline text-ink-muted",
        className,
      )}
      {...props}
    />
  </TabsVariantContext.Provider>
));
TabsList.displayName = TabsPrimitive.List.displayName;

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => {
  const variant = React.useContext(TabsVariantContext);
  return (
    <TabsPrimitive.Trigger
      ref={ref}
      className={cn(
        "inline-flex items-center justify-center whitespace-nowrap text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:pointer-events-none disabled:opacity-50",
        variant === "pill"
          ? "rounded-full px-4 py-1.5 data-[state=active]:bg-surface data-[state=active]:text-brand-indigo data-[state=active]:shadow-soft dark:data-[state=active]:text-brand-violet"
          : "relative -mb-px border-b-2 border-transparent px-1 pb-3 pt-1 uppercase tracking-wide text-xs data-[state=active]:border-brand data-[state=active]:text-brand-indigo dark:data-[state=active]:text-brand-violet",
        className,
      )}
      {...props}
    />
  );
});
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName;

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      "mt-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface",
      className,
    )}
    {...props}
  />
));
TabsContent.displayName = TabsPrimitive.Content.displayName;

export { Tabs, TabsList, TabsTrigger, TabsContent };
