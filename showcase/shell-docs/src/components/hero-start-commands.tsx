"use client";

// <HeroStartActions> — the docs hero's call-to-action row, shared verbatim by
// the home hero and the framework landing heroes so both surfaces read
// identically. The hero offers exactly two entry points, side by side:
//
//   • primary   → copy a ready-to-paste onboarding prompt for a coding agent
//   • secondary → Quickstart, the guided docs walkthrough
//
// Both entry points arrive as slots, so each surface can supply its own wiring
// (prompt text, quickstart href, analytics dimensions) while the layout, order
// and spacing stay identical everywhere. The row stacks vertically on narrow
// viewports and sits side by side from `sm` up.

import React from "react";
import Link from "next/link";
import { usePostHog } from "posthog-js/react";
import { ArrowRight } from "lucide-react";

type QuickstartVariant = "primary" | "secondary";

// Shared geometry: identical height, radius, padding, shadow and arrow across
// variants so the two hero buttons line up pixel for pixel. Only color,
// border and background differ per variant.
const QUICKSTART_BASE_CLASS =
  "shell-docs-radius-control group inline-flex h-11 w-full items-center justify-center gap-2 border px-4 text-sm font-semibold no-underline shadow-[var(--shadow-control)] transition-colors sm:w-fit";

// `shell-docs-primary-cta` / `shell-docs-cta-link` opt the link out of the
// `.reference-content a` prose color, which would otherwise repaint the label
// accent and underline it inside MDX-rendered pages.
const QUICKSTART_VARIANT_CLASS: Record<QuickstartVariant, string> = {
  primary:
    "shell-docs-primary-cta border-[var(--accent)] bg-[var(--accent)] text-[var(--primary-foreground)] hover:bg-[var(--accent-strong)]",
  secondary:
    "shell-docs-cta-link border-[var(--border)] bg-[var(--bg-surface)] text-[var(--text)] hover:border-[var(--accent)] hover:bg-[var(--bg-elevated)] hover:text-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]",
};

// "Start the quickstart" — the accent CTA pointed at a framework's quickstart
// guide. `variant` defaults to "primary" because several framework landing
// pages render this as their only hero button; the docs hero passes
// "secondary" so the prompt button beside it can carry the accent instead.
export function QuickstartLinkButton({
  href,
  frontend,
  backend,
  fromPath,
  variant = "primary",
}: {
  href: string;
  frontend?: string;
  backend?: string;
  fromPath?: string;
  variant?: QuickstartVariant;
}) {
  const posthog = usePostHog();

  const handleClick = React.useCallback(() => {
    try {
      posthog?.capture("docs.journey_continued", {
        destination_type: "quickstart",
        destination_path: href,
        frontend,
        backend,
        from_path: fromPath,
      });
    } catch {
      // Analytics must never block navigation.
    }
  }, [backend, frontend, fromPath, href, posthog]);

  return (
    <Link
      href={href}
      onClick={handleClick}
      className={`${QUICKSTART_BASE_CLASS} ${QUICKSTART_VARIANT_CLASS[variant]}`}
    >
      Quickstart
      <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}

export function HeroStartActions({
  prompt,
  quickstart,
}: {
  prompt: React.ReactNode;
  quickstart: React.ReactNode;
}) {
  return (
    <div className="flex max-w-[820px] flex-col gap-3 sm:flex-row sm:items-center">
      {prompt}
      {quickstart}
    </div>
  );
}
