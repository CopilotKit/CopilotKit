"use client";

import Link from "next/link";
// Fumadocs v16 moved `SidebarTrigger` from `components/layout/sidebar`
// to `components/sidebar/base` — keep the v16 path here.
import { SidebarTrigger } from "fumadocs-ui/components/sidebar/base";
import { Menu } from "lucide-react";
import { usePostHog } from "posthog-js/react";
import { INTELLIGENCE_CTA_HREF } from "./brand-nav";
import { SearchTrigger } from "./search-trigger";
import { CopilotKitMark } from "./copilotkit-mark";
import { ThemeSwitch } from "./theme-switch";
import { PrimaryDocsTabs } from "./primary-docs-tabs";

// Mobile/tablet top nav. Replaces shell-docs's BrandNav below xl because the
// full desktop chrome doesn't fit reliably. Rendered via DocsLayout's
// `nav.component` slot so it sits inside the SidebarProvider —
// `SidebarTrigger` toggles the Fumadocs mobile sidebar
// (`#nd-sidebar-mobile`), which natively renders the page tree we pass
// to DocsLayout.
//
// Positioned `fixed` (mirrors Fumadocs's default Navbar) because the
// nav.component slot otherwise becomes a flex-row sibling of LayoutBody
// inside shell-docs's outer `<main className="flex …">` — without
// fixed positioning, the nav swallows the left half of the viewport.
//
export function MobileTopNav() {
  const posthog = usePostHog();

  const handleFreeDeveloperAccessClick = () => {
    posthog?.capture("try_for_free_clicked", {
      location: "docs_mobile_nav_right",
    });
  };

  return (
    <header
      id="nd-subnav"
      className="shell-docs-mobile-nav xl:hidden fixed top-(--fd-banner-height) left-0 right-0 z-30 border-b border-[var(--border)] bg-[var(--bg)]"
    >
      <div className="shell-docs-mobile-nav-top">
        <Link
          href="/"
          className="shell-docs-mobile-brand"
          aria-label="CopilotKit Docs"
        >
          <CopilotKitMark />
          <span className="font-bold text-[var(--text)] tracking-tight">
            CopilotKit
          </span>
          <span
            className="shell-docs-radius-control border border-[var(--border)] bg-[var(--accent-dim)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--accent)]"
            aria-hidden="true"
          >
            Docs
          </span>
        </Link>
        <PrimaryDocsTabs className="shell-docs-mobile-tabs" />
        <div className="shell-docs-mobile-actions">
          <Link
            href={INTELLIGENCE_CTA_HREF}
            target="_blank"
            rel="noopener noreferrer"
            onClick={handleFreeDeveloperAccessClick}
            className="shell-docs-radius-control hidden h-10 w-10 shrink-0 cursor-pointer items-center justify-center border border-[var(--border)] bg-[var(--bg-surface)] text-[var(--text-muted)] shadow-[var(--shadow-control)] transition-colors hover:border-[var(--accent)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text)] md:flex"
            aria-label="Get Enterprise Intelligence free"
            title="Get Enterprise Intelligence free"
          >
            <CopilotKitMark className="h-5 w-5" />
          </Link>
          <div className="shell-docs-mobile-search">
            <SearchTrigger iconOnly />
          </div>
          <ThemeSwitch />
          <SidebarTrigger
            className="shell-docs-mobile-menu shell-docs-radius-control flex h-10 w-10 items-center justify-center text-[var(--text-muted)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text)]"
            aria-label="Toggle navigation"
          >
            <Menu className="w-5 h-5" />
          </SidebarTrigger>
        </div>
      </div>
    </header>
  );
}
