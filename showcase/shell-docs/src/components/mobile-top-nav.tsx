"use client";

import Link from "next/link";
// Fumadocs v16 moved `SidebarTrigger` from `components/layout/sidebar`
// to `components/sidebar/base` — keep the v16 path here while pulling
// in `main`'s expanded icon set (Calendar / Lightbulb) and PostHog hook
// for the Talk-to-Engineer + Get-Intelligence-free mobile CTAs.
import { SidebarTrigger } from "fumadocs-ui/components/sidebar/base";
import { Calendar, Lightbulb, Menu } from "lucide-react";
import { usePostHog } from "posthog-js/react";
import { SearchTrigger } from "./search-trigger";
import { CopilotKitMark } from "./copilotkit-mark";
import { INTELLIGENCE_CTA_HREF, TALK_TO_ENGINEER_HREF } from "./brand-nav";

// Mobile-only top nav. Replaces shell-docs's BrandNav on small viewports
// because BrandNav's full chrome (3 tabs + Talk-to-Engineer pill +
// slanted SVG wings) doesn't fit. Rendered via DocsLayout's
// `nav.component` slot so it sits INSIDE the SidebarProvider —
// `SidebarTrigger` toggles the Fumadocs mobile sidebar
// (`#nd-sidebar-mobile`), which natively renders the page tree we pass
// to DocsLayout.
//
// Positioned `fixed` (mirrors Fumadocs's default Navbar) because the
// nav.component slot otherwise becomes a flex-row sibling of LayoutBody
// inside shell-docs's outer `<main className="flex …">` — without
// fixed positioning, the nav swallows the left half of the viewport.
//
// The Talk-to-Engineer and Get-Intelligence-free CTAs mirror the
// desktop BrandNav cluster: same destinations, same PostHog events
// (`talk_to_us_clicked` / `try_for_free_clicked`) with `location:
// "docs_navbar_mobile"` so analytics can split mobile from desktop
// (which uses `docs_nav` / `docs_navbar_left`). Matches the canonical
// docs MobileSidebar pattern.
export function MobileTopNav() {
  const posthog = usePostHog();

  const handleTalkToEngineersClick = () => {
    posthog?.capture("talk_to_us_clicked", { location: "docs_navbar_mobile" });
    window.location.href = TALK_TO_ENGINEER_HREF;
  };

  const handleIntelligenceClick = () => {
    posthog?.capture("try_for_free_clicked", {
      location: "docs_navbar_mobile",
    });
  };

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
      {/* Get Intelligence free — muted icon, matches the desktop
       * BrandNav treatment for the same CTA.
       *
       * `suppressHydrationWarning` is required because HubSpot's analytics
       * tag (`js-na2.hs-analytics.net`) rewrites the `href` client-side to
       * append `__hstc` / `__hssc` / `__hsfp` cross-domain tracking params.
       * Server-rendered HTML has the bare URL, post-hydration DOM has the
       * rewritten URL; suppress lets React skip the diff on this one anchor
       * without masking real mismatches elsewhere. Desktop variant in
       * `brand-nav.tsx` takes the same fix for the same reason. */}
      <Link
        href={INTELLIGENCE_CTA_HREF}
        target="_blank"
        rel="noopener noreferrer"
        onClick={handleIntelligenceClick}
        aria-label="Get Intelligence free"
        title="Get Intelligence free"
        className="flex items-center justify-center w-10 h-10 rounded-md text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--bg-elevated)]"
        suppressHydrationWarning
      >
        <Lightbulb className="w-5 h-5" />
      </Link>
      {/* Talk to an Engineer — compact gradient pill, mirrors the
       * desktop md-to-1099px calendar button. */}
      <button
        type="button"
        onClick={handleTalkToEngineersClick}
        aria-label="Talk to an engineer"
        title="Talk to an Engineer"
        className="flex justify-center items-center w-9 h-9 rounded-full bg-gradient-to-r from-indigo-500/90 to-purple-500/90 text-white shadow-sm hover:from-indigo-500 hover:to-purple-500 hover:shadow-md transition-all duration-200 cursor-pointer relative overflow-hidden after:content-[''] after:absolute after:inset-0 after:bg-gradient-to-r after:from-transparent after:via-white/30 after:to-transparent after:-translate-x-full hover:after:translate-x-[100%] after:transition-transform after:duration-700 after:pointer-events-none"
      >
        <Calendar className="w-[18px] h-[18px]" />
      </button>
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
