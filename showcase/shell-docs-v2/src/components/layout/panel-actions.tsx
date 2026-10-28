"use client";

import type { ComponentProps } from "react";
import Link from "fumadocs-core/link";
import { buttonVariants } from "fumadocs-ui/components/ui/button";
import { useSpaciousLayout } from "fumadocs-ui/layouts/spacious";
import { AdaptiveThemeSwitch } from "./theme-toggle";
import { cn } from "@/lib/cn";

/**
 * Spacious' `actions` slot: the icon links and the theme switch sit in the
 * page panel's corner instead of behind the overflow menu. "Ask AI" opens
 * from its own round button in the page's bottom-right corner instead
 * (`src/components/ai/docs-layout.tsx`).
 */
export function PanelActions({ className, ...props }: ComponentProps<"div">) {
  const { menuItems } = useSpaciousLayout();
  return (
    <div
      className={cn(
        "flex items-center gap-1 rounded-lg bg-fd-background",
        className,
      )}
      {...props}
    >
      {menuItems.map((item, i) =>
        item.type === "icon" ? (
          <Link
            key={i}
            href={item.url}
            external={item.external}
            aria-label={item.label}
            className={cn(
              buttonVariants({ variant: "ghost", size: "icon-sm" }),
              "text-fd-muted-foreground",
            )}
          >
            {item.icon}
          </Link>
        ) : null,
      )}
      <AdaptiveThemeSwitch className="ms-1" />
    </div>
  );
}
