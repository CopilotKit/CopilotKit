"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { usePostHog } from "posthog-js/react";
import { CalendarDays, ChefHat } from "lucide-react";
import { SearchTrigger } from "./search-trigger";
import { CopilotKitMark } from "./copilotkit-mark";
import { ThemeSwitch } from "./theme-switch";
import BookIcon from "./icons/book";
import ConsoleIcon from "./icons/console";
import ExternalLinkIcon from "./icons/external-link";

// Enterprise Intelligence sign-up CTA. UTM params let marketing
// attribute navbar-driven sign-ups distinctly from in-content SignupLink
// and OpsPlatformCTA clicks. Exported so MobileTopNav reuses the same URL.
export const INTELLIGENCE_CTA_HREF =
  "https://dashboard.operations.copilotkit.ai/?utm_source=docs&utm_medium=cta&utm_campaign=intelligence&utm_content=navbar";

export const TALK_TO_ENGINEER_HREF =
  "https://copilotkit.ai/talk-to-an-engineer";

// Center cluster — primary docs destinations only. Conversion CTAs live in
// the right utility cluster so the center nav stays balanced.
type LeftLink = {
  href: string;
  label: string;
  icon: React.ReactNode;
};

const LEFT_LINKS: LeftLink[] = [
  {
    icon: <BookIcon className="text-current" />,
    label: "Docs",
    href: "/",
  },
  {
    icon: <ConsoleIcon className="text-current" />,
    label: "Reference",
    href: "/reference",
  },
  {
    icon: <ChefHat className="w-5 h-5 text-current" />,
    label: "Cookbook",
    href: "/cookbook",
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
  // anything under /cookbook highlights Cookbook, everything else (root,
  // framework-scoped pages) highlights Docs.
  const firstSegment = pathname === "/" ? "/" : `/${pathname.split("/")[1]}`;
  const activeRoute =
    firstSegment === "/reference"
      ? "/reference"
      : firstSegment === "/cookbook"
        ? "/cookbook"
        : "/";

  const handleTalkToEngineersClick = () => {
    posthog?.capture("talk_to_us_clicked", { location: "docs_nav" });
    window.location.href = TALK_TO_ENGINEER_HREF;
  };

  const handleFreeDeveloperAccessClick = () => {
    posthog?.capture("try_for_free_clicked", { location: "docs_navbar_right" });
  };

  return (
    <nav className="shell-docs-brand-nav relative hidden h-16 bg-[var(--bg)] xl:mx-[22px] xl:block">
      <div className="shell-docs-brand-nav-inner relative grid h-full grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-4 bg-[var(--nav-surface)]">
        <Link
          href="/"
          className="shell-docs-brand-link flex min-w-0 shrink-0 items-center gap-2 justify-self-start"
          aria-label="CopilotKit Docs"
        >
          <CopilotKitMark />
          <span className="text-base font-bold tracking-tight text-[var(--text)]">
            CopilotKit
          </span>
          <span
            className="shell-docs-radius-control ml-1 border border-[var(--border)] bg-[var(--accent-dim)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--accent)]"
            aria-hidden="true"
          >
            Docs
          </span>
        </Link>
        <ul className="hidden min-w-0 items-center gap-2 justify-self-center xl:flex">
          {LEFT_LINKS.map((link) => {
            const isActive = activeRoute === link.href;
            return (
              <li key={link.href} className="relative h-full group">
                <Link
                  href={link.href}
                  className={`shell-docs-radius-control flex h-10 items-center px-4 transition-colors duration-200 ${
                    isActive
                      ? "shell-docs-nav-link-active"
                      : "shell-docs-nav-link-idle"
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <span className="[@media(width<808px)]:hidden">
                      {link.icon}
                    </span>
                    <span className="text-sm font-medium whitespace-nowrap">
                      {link.label}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>

        <div className="flex min-w-0 items-center gap-2 justify-self-end pl-2">
          <SearchTrigger iconOnly />
          <Link
            href={INTELLIGENCE_CTA_HREF}
            target="_blank"
            rel="noopener noreferrer"
            onClick={handleFreeDeveloperAccessClick}
            className="shell-docs-nav-cta shell-docs-radius-control hidden h-10 cursor-pointer items-center gap-2 whitespace-nowrap border px-4 text-sm font-medium no-underline shadow-[var(--shadow-control)] transition-colors duration-200 [@media(width>=1280px)]:flex"
            aria-label="Get Enterprise Intelligence free"
            suppressHydrationWarning
          >
            Get Enterprise Intelligence free
            <ExternalLinkIcon className="text-current opacity-70" />
          </Link>
          {/* Talk to an engineer. Secondary in the docs nav so search can own
           * the far-right utility slot. */}
          <button
            type="button"
            onClick={handleTalkToEngineersClick}
            className="shell-docs-nav-cta shell-docs-radius-control hidden h-10 cursor-pointer items-center whitespace-nowrap border px-4 text-sm font-medium shadow-[var(--shadow-control)] transition-colors duration-200 [@media(width>=1500px)]:flex"
            aria-label="Talk to an engineer"
          >
            Talk to an engineer
          </button>
          <button
            type="button"
            onClick={handleTalkToEngineersClick}
            className="shell-docs-nav-cta shell-docs-radius-control hidden h-10 w-10 cursor-pointer items-center justify-center border shadow-[var(--shadow-control)] transition-colors duration-200 xl:flex [@media(width>=1500px)]:hidden"
            aria-label="Talk to an engineer"
            title="Talk to an engineer"
          >
            <CalendarDays className="h-4 w-4" />
          </button>
          <ThemeSwitch />
        </div>
      </div>
    </nav>
  );
}
