"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { usePostHog } from "posthog-js/react";
import { Lightbulb } from "lucide-react";
import { SearchTrigger } from "./search-trigger";
import { CopilotKitMark } from "./copilotkit-mark";
import BookIcon from "./icons/book";
import ConsoleIcon from "./icons/console";
import ExternalLinkIcon from "./icons/external-link";

// Enterprise Intelligence Platform sign-up CTA. UTM params let marketing
// attribute navbar-driven sign-ups distinctly from in-content SignupLink
// and OpsPlatformCTA clicks. Exported so MobileTopNav reuses the same URL.
export const INTELLIGENCE_CTA_HREF =
  "https://dashboard.operations.copilotkit.ai/?utm_source=docs&utm_medium=cta&utm_campaign=intelligence&utm_content=navbar";

export const TALK_TO_ENGINEER_HREF =
  "https://copilotkit.ai/talk-to-an-engineer";

// LEFT cluster — Docs / Reference / Intelligence sign-up. Visual pattern
// (icon-next-to-label) mirrors canonical. The third slot label matches the
// in-content OpsPlatformCTA default ("Get Intelligence free") so the
// conversion path reads consistently from navbar to body to footer.
type LeftLink = {
  href: string;
  label: string;
  icon: React.ReactNode;
  target?: "_blank" | "_self";
  showExternalLinkIcon?: boolean;
};

const LEFT_LINKS: LeftLink[] = [
  {
    icon: <BookIcon className="text-[var(--text-secondary)]" />,
    label: "Docs",
    href: "/",
  },
  {
    icon: <ConsoleIcon className="text-[var(--text-secondary)]" />,
    label: "Reference",
    href: "/reference",
  },
  {
    icon: <Lightbulb className="w-5 h-5 text-[var(--text-secondary)]" />,
    label: "Get Intelligence free",
    href: INTELLIGENCE_CTA_HREF,
    target: "_blank",
    showExternalLinkIcon: true,
  },
];

export interface BrandNavProps {
  // Preserved for backwards compat with the original call site signature.
  // The framework selector lives in the docs sidebar now, not the navbar.
  frameworkOptions?: unknown;
  frameworkCategoryOrder?: unknown;
}

export function BrandNav(_props: BrandNavProps = {}) {
  const pathname = usePathname();
  const posthog = usePostHog();

  // Active-route detection: anything under /reference highlights Reference,
  // everything else (root, framework-scoped pages) highlights Docs.
  const firstSegment = pathname === "/" ? "/" : `/${pathname.split("/")[1]}`;
  const activeRoute = firstSegment === "/reference" ? "/reference" : "/";

  const handleTalkToEngineersClick = () => {
    posthog?.capture("talk_to_us_clicked", { location: "docs_nav" });
    window.location.href = TALK_TO_ENGINEER_HREF;
  };

  const handleFreeDeveloperAccessClick = () => {
    posthog?.capture("try_for_free_clicked", { location: "docs_navbar_left" });
  };

  return (
    <nav className="relative hidden h-[86px] bg-[var(--bg)] px-[22px] py-3 md:block">
      {/* Cap the BrandNav's visible chrome at the same `--fd-layout-width`
       * (97rem) that the fumadocs docs grid uses, and center it. At
       * wide viewports this keeps the BrandNav's left/right edges
       * aligned with the sidebar column on the left and the docs content
       * column on the right; at narrower viewports it's a no-op
       * because the inner width never reaches the cap. */}
      <div
        className="mx-auto flex h-full max-w-[1534px] items-center gap-5 rounded-lg border border-[var(--border)] px-5 shadow-[0_1px_0_rgba(1,5,7,0.03)] backdrop-blur-lg"
        style={{ backgroundColor: "var(--nav-surface)" }}
      >
        <Link
          href="/"
          className="flex shrink-0 items-center gap-2"
          aria-label="CopilotKit Docs"
        >
          <CopilotKitMark />
          <span className="text-base font-bold tracking-tight text-[var(--text)]">
            CopilotKit
          </span>
          <span
            className="ml-1 rounded-lg border border-[var(--border)] bg-[var(--accent-dim)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--accent)]"
            aria-hidden="true"
          >
            Docs
          </span>
        </Link>
        <ul className="hidden h-full items-center gap-1 md:flex">
          {LEFT_LINKS.map((link) => {
            const isActive = activeRoute === link.href;
            const isFreeDevAccess = link.label === "Get Intelligence free";
            return (
              <li
                key={link.href}
                className={`relative h-full group ${
                  isFreeDevAccess ? "hidden [@media(width>=960px)]:block" : ""
                }`}
              >
                <Link
                  href={link.href}
                  target={link.target}
                  onClick={
                    isFreeDevAccess ? handleFreeDeveloperAccessClick : undefined
                  }
                  className={`flex h-full items-center rounded-lg px-3 transition-colors duration-200 ${
                    isActive
                      ? "text-[var(--text)]"
                      : "text-[var(--text-muted)] hover:bg-[var(--bg-elevated)]/70 hover:text-[var(--text)]"
                  }`}
                  // HubSpot's analytics tag rewrites the
                  // dashboard.operations.copilotkit.ai href client-side to
                  // attach `__hstc` / `__hssc` / `__hsfp` cross-domain
                  // tracking params, which trips React's hydration diff.
                  // Suppress only on the Intelligence link so genuine
                  // mismatches on other nav items still surface.
                  suppressHydrationWarning={isFreeDevAccess}
                >
                  <span className="flex items-center gap-2">
                    <span className="[@media(width<808px)]:hidden">
                      {link.icon}
                    </span>
                    <span className="text-sm font-medium whitespace-nowrap">
                      {link.label}
                    </span>
                    {link.showExternalLinkIcon && (
                      <ExternalLinkIcon className="text-current opacity-60" />
                    )}
                  </span>
                </Link>
                <div
                  className="absolute bottom-0 left-3 right-3 h-[2px] rounded-full bg-[#7076D5] transition-opacity duration-200"
                  style={{ opacity: isActive ? 1 : 0 }}
                  aria-hidden="true"
                />
              </li>
            );
          })}
        </ul>

        <div className="ml-auto flex min-w-0 items-center gap-2 pl-2">
          {/* Talk to an engineer. Secondary in the docs nav so search can own
           * the far-right utility slot. */}
          <button
            type="button"
            onClick={handleTalkToEngineersClick}
            className="hidden h-9 cursor-pointer items-center whitespace-nowrap rounded-lg border border-[var(--accent)] bg-[var(--accent-dim)] px-3.5 text-sm font-medium text-[var(--accent)] shadow-[0_1px_0_rgba(1,5,7,0.03)] transition-colors duration-200 hover:bg-[var(--accent)] hover:text-white [@media(width>=1100px)]:flex"
            aria-label="Talk to an engineer"
          >
            Talk to an engineer
          </button>
          <button
            type="button"
            onClick={handleTalkToEngineersClick}
            className="hidden h-9 w-9 cursor-pointer items-center justify-center rounded-lg border border-[var(--accent)] bg-[var(--accent-dim)] text-[var(--accent)] shadow-[0_1px_0_rgba(1,5,7,0.03)] transition-colors duration-200 hover:bg-[var(--accent)] hover:text-white md:flex [@media(width>=1100px)]:hidden"
            aria-label="Talk to an engineer"
            title="Talk to an engineer"
          >
            <svg
              width="17"
              height="17"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
          </button>
          <SearchTrigger iconOnly />
        </div>
      </div>
    </nav>
  );
}
