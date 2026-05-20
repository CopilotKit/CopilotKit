"use client";

import Link from "next/link";
import { SidebarTrigger } from "fumadocs-ui/components/layout/sidebar";
import { Menu } from "lucide-react";
import { SearchTrigger } from "./search-trigger";
import { CopilotKitMark } from "./copilotkit-mark";

// Mobile-only top nav. Replaces shell-docs's BrandNav on small viewports
// because BrandNav's full chrome (4 tabs + right cluster + slanted SVG
// wings) doesn't fit. Rendered via DocsLayout's `nav.component` slot so
// it sits INSIDE the SidebarProvider — `SidebarTrigger` toggles the
// Fumadocs mobile sidebar (`#nd-sidebar-mobile`), which natively renders
// the page tree we pass to DocsLayout.
//
// Positioned `fixed` (mirrors Fumadocs's default Navbar) because the
// nav.component slot otherwise becomes a flex-row sibling of LayoutBody
// inside shell-docs's outer `<main className="flex …">` — without
// fixed positioning, the nav swallows the left half of the viewport.
export function MobileTopNav() {
  return (
    <header
      id="nd-subnav"
      className="md:hidden fixed top-(--fd-banner-height) left-0 right-0 z-30 flex items-center gap-1 px-3 h-14 border-b border-[var(--border)] bg-[var(--bg)]"
    >
      <Link
        href="/"
        className="flex items-center gap-2 mr-auto"
        aria-label="CopilotKit Docs"
      >
        <CopilotKitMark />
        <span className="font-bold text-[var(--text)] tracking-tight">
          CopilotKit
        </span>
        <span
          className="rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--accent)] bg-[var(--accent-dim)] border border-[var(--border)]"
          aria-hidden="true"
        >
          Docs
        </span>
      </Link>
      <SearchTrigger />
      <SidebarTrigger
        className="flex items-center justify-center w-10 h-10 -mr-1 rounded-md text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--bg-elevated)]"
        aria-label="Toggle navigation"
      >
        <Menu className="w-5 h-5" />
      </SidebarTrigger>
    </header>
  );
}
