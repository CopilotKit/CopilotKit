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
    <nav className="relative h-[80px] xl:h-[104px] px-[22px] py-2 xl:py-3 bg-[var(--bg)] hidden md:block">
      {/* Cap the BrandNav's visible chrome at the same `--fd-layout-width`
       * (97rem) that the fumadocs docs grid uses, and center it. At
       * wide viewports this keeps the BrandNav's left/right edges
       * aligned with the sidebar pill on the left and the docs content
       * column on the right; at narrower viewports it's a no-op
       * because the inner width never reaches the cap. */}
      <div className="flex justify-between items-center w-full h-full max-w-[97rem] mx-auto">
        {/* Left half (logo + nav links) */}
        <div className="flex w-full h-full">
          <div
            className="flex gap-11 items-center w-full h-full rounded-l-2xl border border-r-0 backdrop-blur-lg border-[var(--border)]"
            style={{ backgroundColor: "var(--nav-surface)" }}
          >
            <Link
              href="/"
              className="flex items-center gap-2 pl-6 shrink-0"
              aria-label="CopilotKit Docs"
            >
              <CopilotKitMark />
              <span className="text-base font-bold tracking-tight text-[var(--text)]">
                CopilotKit
              </span>
              <span
                className="ml-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--accent)] bg-[var(--accent-dim)] border border-[var(--border)]"
                aria-hidden="true"
              >
                Docs
              </span>
            </Link>
            <ul className="hidden gap-6 items-center h-full md:flex me-auto">
              {LEFT_LINKS.map((link) => {
                const isActive = activeRoute === link.href;
                const isFreeDevAccess = link.label === "Get Intelligence free";
                return (
                  <li key={link.href} className="relative h-full group">
                    <Link
                      href={link.href}
                      target={link.target}
                      onClick={
                        isFreeDevAccess
                          ? handleFreeDeveloperAccessClick
                          : undefined
                      }
                      className={`h-full ${
                        isActive ? "opacity-100" : "opacity-50"
                      } hover:opacity-100 transition-opacity duration-300`}
                    >
                      <span className="flex gap-2 items-center h-full text-[var(--text-secondary)]">
                        <span className="[@media(width<808px)]:hidden">
                          {link.icon}
                        </span>
                        <span className="text-sm font-medium whitespace-nowrap">
                          {link.label}
                        </span>
                        {link.showExternalLinkIcon && (
                          <ExternalLinkIcon className="text-[var(--text-muted)]" />
                        )}
                      </span>
                    </Link>
                    {/* Active-tab underline. Mirrors canonical exactly:
                     * every link renders the violet line persistently, and
                     * active state is bound to opacity only (300ms ease-out
                     * cubic-bezier) — so navigating between tabs cross-fades
                     * the lines instead of snapping. Per-link width comes
                     * from each li (icon + gap + label), which is why the
                     * effect reads as "narrow → wider" between tabs of
                     * different label lengths. The literal #7076D5 (not
                     * --accent, which is a deeper violet) matches canonical. */}
                    <div
                      className="absolute bottom-0 left-0 w-full h-[3px] bg-[#7076D5] transition-opacity duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]"
                      style={{ opacity: isActive ? 1 : 0 }}
                      aria-hidden="true"
                    />
                  </li>
                );
              })}
            </ul>

            {/* Talk to an engineer — pushed to the right edge of the
             * left wing (the `me-auto` on the nav links above shoves
             * everything else to where this button lives). Pill at
             * ≥1100px, compact calendar icon at md-to-1099px. */}
            <button
              type="button"
              onClick={handleTalkToEngineersClick}
              className="hidden [@media(width>=1100px)]:flex items-center h-9 px-4 mr-4 text-sm font-medium rounded-full bg-gradient-to-br from-[#8b5cf6] to-[var(--accent)] text-white shadow-sm hover:brightness-110 transition-[filter] duration-200 cursor-pointer whitespace-nowrap relative overflow-hidden after:content-[''] after:absolute after:inset-0 after:bg-gradient-to-r after:from-transparent after:via-white/30 after:to-transparent after:-translate-x-full hover:after:translate-x-[100%] after:transition-transform after:duration-700 after:pointer-events-none"
              aria-label="Talk to an engineer"
            >
              Talk to an engineer
            </button>
            <button
              type="button"
              onClick={handleTalkToEngineersClick}
              className="hidden md:flex [@media(width>=1100px)]:hidden justify-center items-center w-9 h-9 mr-4 rounded-full bg-gradient-to-br from-[#8b5cf6] to-[var(--accent)] text-white shadow-sm hover:brightness-110 transition-[filter] duration-200 cursor-pointer relative overflow-hidden after:content-[''] after:absolute after:inset-0 after:bg-gradient-to-r after:from-transparent after:via-white/30 after:to-transparent after:-translate-x-full hover:after:translate-x-[100%] after:transition-transform after:duration-700 after:pointer-events-none"
              aria-label="Talk to an engineer"
              title="Talk to an engineer"
            >
              <svg
                width="18"
                height="18"
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
          </div>

          {/* Slanted end border — plain <img> avoids next/image's
           * static-import requirement and renders these decorative SVGs
           * exactly as authored. The light/dark variants pair with the
           * theme toggle below. */}
          <img
            src="/images/navbar/slanted-end-border-dark.svg"
            alt=""
            width={29}
            height={72}
            className="hidden -ml-px dark:inline-block shrink-0 h-full w-auto object-cover"
          />
          <img
            src="/images/navbar/slanted-end-border-light.svg"
            alt=""
            width={29}
            height={72}
            className="-ml-px dark:hidden shrink-0 h-full w-auto object-cover"
          />
        </div>

        {/* Right half (utilities + search + mobile burger).
         * `ml-2` (was `-ml-[7px]`) introduces a small breathing gap
         * between the left card's trailing slanted wing and the right
         * half's leading slanted wing, so the two wings read as a
         * deliberate seam rather than touching/overlapping. */}
        <div className="flex items-center w-max h-full shrink-0 ml-2">
          <img
            src="/images/navbar/slanted-start-border-dark.svg"
            alt=""
            width={29}
            height={72}
            className="hidden -mr-px dark:inline-block shrink-0 h-full w-auto object-cover"
          />
          <img
            src="/images/navbar/slanted-start-border-light.svg"
            alt=""
            width={29}
            height={72}
            className="-mr-px dark:hidden shrink-0 h-full w-auto object-cover"
          />

          <div
            className="flex gap-1 items-center pr-2 w-max h-full rounded-r-2xl border border-l-0 backdrop-blur-lg md:pr-4 shrink-0 border-[var(--border)] cursor-pointer"
            style={{ backgroundColor: "var(--nav-surface)" }}
            onClick={(e) => {
              // Make the whole right wing a search target — only fire when
              // the click didn't already land on the inner SearchTrigger
              // button (otherwise we'd toggle the modal twice).
              const target = e.target as HTMLElement;
              if (target.closest("button[aria-label='Search']")) return;
              const inner = e.currentTarget.querySelector(
                "button[aria-label='Search']",
              ) as HTMLButtonElement | null;
              inner?.click();
            }}
          >
            {/* Right wing is just the search now — Talk to an engineer
             * moved to the right edge of the left wing, and GitHub /
             * Discord / theme toggle live at the bottom of the docs
             * sidebar (see SidebarFooter). */}
            <SearchTrigger />
          </div>
        </div>
      </div>
    </nav>
  );
}
