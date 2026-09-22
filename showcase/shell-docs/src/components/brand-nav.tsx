"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { usePostHog } from "posthog-js/react";
import { SearchTrigger } from "./search-trigger";
import { CopilotKitMark } from "./copilotkit-mark";
import { DocsMegaMenu } from "./docs-mega-menu";
import { isDocsExplorePath } from "@/lib/docs-mega-menu";
import {
  DocsPublicAuthControl,
  buildDocsAuthEntryHref,
  useDocsAuthAction,
} from "./docs-public-auth-control";

// CopilotKit Intelligence sign-up CTA. UTM params let marketing
// attribute navbar-driven sign-ups distinctly from in-content SignupLink
// and OpsPlatformCTA clicks. Exported so MobileTopNav reuses the same URL.
export const INTELLIGENCE_CTA_HREF =
  "https://dashboard.operations.copilotkit.ai/?utm_source=docs&utm_medium=cta&utm_campaign=intelligence&utm_content=navbar";
export { buildDocsAuthEntryHref };

export const TALK_TO_ENGINEER_HREF =
  "https://copilotkit.ai/talk-to-an-engineer";

// Center cluster — primary docs destinations only. Conversion CTAs live in
// the right utility cluster so the center nav stays balanced.
type LeftLink = {
  href: string;
  label: string;
};

const LEFT_LINKS: LeftLink[] = [
  {
    label: "Reference",
    href: "/reference",
  },
  {
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
  const authAction = useDocsAuthAction();
  const [contentScrolled, setContentScrolled] = useState(false);

  useEffect(() => {
    const scroller = document.querySelector<HTMLElement>(
      ".docs-content-wrapper",
    );
    if (!scroller) return;

    const updateScrollShadow = () => setContentScrolled(scroller.scrollTop > 1);
    updateScrollShadow();
    scroller.addEventListener("scroll", updateScrollShadow, { passive: true });
    return () => scroller.removeEventListener("scroll", updateScrollShadow);
  }, [pathname]);

  // Active-route detection: Reference and Cookbook each own their prefix.
  // Everything else highlights Docs.
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

  const handleAuthClick = () => {
    posthog?.capture(
      authAction.label === "Sign up"
        ? "try_for_free_clicked"
        : "sign_in_clicked",
      {
        location: "docs_navbar_right",
      },
    );
  };

  return (
    <nav
      className="shell-docs-brand-nav relative hidden bg-[var(--bg)] xl:block"
      data-content-scrolled={contentScrolled || undefined}
    >
      <div className="shell-docs-brand-nav-inner relative grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-x-8 bg-[var(--nav-surface)]">
        <Link
          href="/"
          className="shell-docs-brand-link flex min-w-0 shrink-0 items-center gap-2 justify-self-start"
          aria-label="CopilotKit Docs"
        >
          <span className="text-xl font-bold tracking-tight text-[var(--text)]">
            CopilotKit
          </span>
          <CopilotKitMark />
        </Link>
        <ul className="hidden min-w-0 items-center gap-2 justify-self-center xl:flex">
          <li className="relative h-full">
            <DocsMegaMenu
              triggerClassName={`shell-docs-brand-nav-menu shell-docs-radius-control h-10 px-3 text-base font-medium whitespace-nowrap transition-colors duration-200 ${
                isDocsExplorePath(pathname)
                  ? "shell-docs-nav-link-active"
                  : "shell-docs-nav-link-idle"
              }`}
            />
          </li>
          {LEFT_LINKS.map((link) => {
            const isActive = activeRoute === link.href;
            return (
              <li key={link.href} className="relative h-full group">
                <Link
                  href={link.href}
                  className={`shell-docs-radius-control flex h-10 items-center px-3 transition-colors duration-200 ${
                    isActive
                      ? "shell-docs-nav-link-active"
                      : "shell-docs-nav-link-idle"
                  }`}
                >
                  <span className="text-base font-medium whitespace-nowrap">
                    {link.label}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>

        <div className="flex min-w-0 items-center gap-3 justify-self-end pl-4">
          <SearchTrigger iconOnly />
          <DocsPublicAuthControl
            fallback={
              <Link
                href={authAction.href}
                target="_blank"
                rel="noopener noreferrer"
                onClick={handleAuthClick}
                className="shell-docs-auth-link flex h-10 shrink-0 cursor-pointer items-center justify-center whitespace-nowrap px-4 text-sm font-medium no-underline transition-colors duration-200"
                aria-label={`${authAction.label} to CopilotKit Intelligence`}
                suppressHydrationWarning
              >
                {authAction.label}
              </Link>
            }
          />
          <button
            type="button"
            onClick={handleTalkToEngineersClick}
            className="shell-docs-nav-cta cursor-pointer whitespace-nowrap px-4 text-sm font-medium transition-colors duration-200"
            aria-label="Talk to an engineer"
          >
            Talk to an Engineer
          </button>
        </div>
      </div>
    </nav>
  );
}
