"use client";

import type { ComponentProps } from "react";
import Link from "fumadocs-core/link";
import { buttonVariants } from "fumadocs-ui/components/ui/button";
import {
  SidebarCollapseTrigger,
  useSidebar,
} from "fumadocs-ui/components/sidebar/base";
import { useSpaciousLayout } from "fumadocs-ui/layouts/spacious";
import { SidebarIcon } from "lucide-react";
import { AdaptiveThemeSwitch } from "./theme-toggle";
import { cn } from "@/lib/cn";

/** The layout's icon links (Discord, X, GitHub) as small ghost buttons. */
export function IconLinks({ className, ...props }: ComponentProps<"div">) {
  const { menuItems } = useSpaciousLayout();
  return (
    <div className={cn("flex items-center gap-1", className)} {...props}>
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
    </div>
  );
}

/**
 * The icon links and the theme switch, out in the open instead of behind
 * Spacious' overflow menu. Drawn in the docs' top bar on the frame above the
 * page panel (`topBar` in `src/proto/layout-client.tsx`). "Ask AI" opens
 * from its own round button in the page's bottom-right corner instead
 * (`src/components/ai/docs-layout.tsx`).
 */
export function PanelActions({ className, ...props }: ComponentProps<"div">) {
  return (
    <div className={cn("flex items-center gap-1", className)} {...props}>
      <IconLinks />
      <AdaptiveThemeSwitch className="ms-1" />
    </div>
  );
}

/**
 * Spacious' `actions` slot, in the page panel's header: the sidebar toggle,
 * moved to the panel's top-left corner so it sits in one place whether the
 * sidebar is open or collapsed. Spacious draws its own toggle there only when
 * collapsed (and one beside the logo when open); theme.css hides both, and
 * this one, first in the header row, takes their place. The header is
 * desktop-only, so phones keep their own menu button.
 */
export function PanelSidebarToggle() {
  const { collapsed } = useSidebar();
  return (
    <SidebarCollapseTrigger
      data-panel-sidebar-toggle=""
      aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      className={cn(
        buttonVariants({ variant: "ghost", size: "icon-sm" }),
        "order-first -ms-2 size-8 shrink-0 text-fd-muted-foreground",
      )}
    >
      <SidebarIcon />
    </SidebarCollapseTrigger>
  );
}
