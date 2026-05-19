"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { usePostHog } from "posthog-js/react";
import { SearchTrigger } from "./search-trigger";
import { CopilotKitMark } from "./copilotkit-mark";
import RocketIcon from "./icons/rocket";
import ConsoleIcon from "./icons/console";
import ExternalLinkIcon from "./icons/external-link";

// LEFT cluster — Docs / Reference. Visual pattern (icon-next-to-label)
// mirrors canonical.
type LeftLink = {
  href: string;
  label: string;
  icon: React.ReactNode;
  target?: "_blank" | "_self";
  showExternalLinkIcon?: boolean;
};

const LEFT_LINKS: LeftLink[] = [
  {
    icon: <RocketIcon className="text-[var(--text-secondary)]" />,
    label: "Docs",
    href: "/",
  },
  {
    icon: <ConsoleIcon className="text-[var(--text-secondary)]" />,
    label: "Reference",
    href: "/reference",
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
    window.location.href = "https://copilotkit.ai/talk-to-an-engineer";
  };

  return (
    <nav className="relative h-[68px] xl:h-[88px] px-3 py-1 xl:py-2 bg-[var(--bg)] hidden md:block">
      <div className="flex justify-between items-center w-full h-full">
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
                const hideIconAtNarrow =
                  link.label === "Docs" || link.label === "Reference";
                const isActive = activeRoute === link.href;
                return (
                  <li key={link.href} className="relative h-full group">
                    <Link
                      href={link.href}
                      target={link.target}
                      className={`h-full ${
                        isActive ? "opacity-100" : "opacity-50"
                      } hover:opacity-100 transition-opacity duration-300`}
                    >
                      <span className="flex gap-2 items-center h-full text-[var(--text-secondary)]">
                        <span
                          className={
                            hideIconAtNarrow
                              ? "[@media(width<808px)]:hidden"
                              : ""
                          }
                        >
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

            {/* Talk to an Engineer — pushed to the right edge of the
             * left wing (the `me-auto` on the nav links above shoves
             * everything else to where this button lives). Pill at
             * ≥1100px, compact calendar icon at md-to-1099px. */}
            <button
              type="button"
              onClick={handleTalkToEngineersClick}
              className="hidden [@media(width>=1100px)]:flex items-center h-9 px-4 mr-4 text-sm font-medium rounded-full bg-gradient-to-r from-indigo-500/90 to-purple-500/90 text-white shadow-sm hover:from-indigo-500 hover:to-purple-500 hover:shadow-md transition-all duration-200 cursor-pointer whitespace-nowrap relative overflow-hidden after:content-[''] after:absolute after:inset-0 after:bg-gradient-to-r after:from-transparent after:via-white/30 after:to-transparent after:-translate-x-full hover:after:translate-x-[100%] after:transition-transform after:duration-700 after:pointer-events-none"
              aria-label="Talk to an engineer"
            >
              Talk to an Engineer
            </button>
            <button
              type="button"
              onClick={handleTalkToEngineersClick}
              className="hidden md:flex [@media(width>=1100px)]:hidden justify-center items-center w-9 h-9 mr-4 rounded-full bg-gradient-to-r from-indigo-500/90 to-purple-500/90 text-white shadow-sm hover:from-indigo-500 hover:to-purple-500 hover:shadow-md transition-all duration-200 cursor-pointer relative overflow-hidden after:content-[''] after:absolute after:inset-0 after:bg-gradient-to-r after:from-transparent after:via-white/30 after:to-transparent after:-translate-x-full hover:after:translate-x-[100%] after:transition-transform after:duration-700 after:pointer-events-none"
              aria-label="Talk to an engineer"
              title="Talk to an Engineer"
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

        {/* Right half (utilities + search + mobile burger) */}
        <div className="flex items-center w-max h-full shrink-0 -ml-[7px]">
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
            {/* Right wing is just the search now — Talk to an Engineer
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
