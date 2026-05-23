"use client";

// DocsLandingNext — the "what comes after the product overview" block on
// the docs landing at `/`. Always renders the "Continue with {framework}"
// pointers using `effectiveFramework` (Built-in Agent by default; the
// user's stored pick or URL-active framework if either is set), then a
// "Switch framework" picker grid below so other backends remain one
// click away.
//
// Old behaviour: branched on `storedFramework`. Null showed a forced
// picker, set showed "Continue with X". The forced-picker branch was a
// dead end for fresh visitors who hadn't yet decided which backend to
// build against. Soft-defaulting to BIA via `effectiveFramework` lets
// us collapse the two branches into one and keep the picker as a
// secondary affordance instead of a gate.

import React from "react";
import Link from "next/link";
import { useFramework } from "./framework-provider";
import { StoredFrameworkHighlight } from "./stored-framework-highlight";
import { FrameworkLogo } from "./icons/framework-icons";
import { compareByDisplayOrder } from "@/lib/framework-order";
import { getDocsMode, getIntegration, getIntegrations } from "@/lib/registry";

function FrameworkPicker({
  heading,
  description,
}: {
  heading: string;
  description: string;
}) {
  // Drop Built-in Agent: it's the soft-default the page is already
  // rendering as, so showing it under "Switch backend" would just be a
  // no-op tile. Sort by the canonical display order — the previous
  // category buckets ("Most Popular / Agent Frameworks / Enterprise /
  // Emerging") read as a tier list and we've dropped them in favour
  // of one flat, neutral grid.
  const integrations = getIntegrations()
    // `docs_mode: hidden` frameworks have no docs page — surfacing them
    // here would link straight to a 404.
    .filter(
      (i) => i.slug !== "built-in-agent" && getDocsMode(i.slug) !== "hidden",
    )
    .slice()
    .sort((a, b) => compareByDisplayOrder(a.slug, b.slug));

  return (
    <section className="not-prose">
      <h2 className="text-xl font-semibold text-[var(--text)] mb-1">
        {heading}
      </h2>
      <p className="text-sm text-[var(--text-secondary)] mb-5">{description}</p>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
        {integrations.map((i) => (
          <Link
            key={i.slug}
            href={`/${i.slug}`}
            className="group relative flex items-center gap-2.5 p-3 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] hover:border-[var(--accent)] transition-colors"
          >
            <span
              aria-hidden="true"
              className="flex items-center justify-center w-7 h-7 rounded-md bg-[var(--bg-elevated)] group-hover:bg-[var(--bg-surface)] transition-colors shrink-0"
            >
              <FrameworkLogo
                slug={i.slug}
                fallbackSrc={i.logo}
                size={16}
                className="text-[var(--text-secondary)] group-hover:text-[var(--accent)]"
              />
            </span>
            <span className="flex-1 min-w-0 truncate text-sm font-medium text-[var(--text)] group-hover:text-[var(--accent)]">
              {i.name}
            </span>
            <StoredFrameworkHighlight slug={i.slug} />
          </Link>
        ))}
      </div>
    </section>
  );
}

export function DocsLandingNext() {
  const { effectiveFramework } = useFramework();

  const integration = getIntegration(effectiveFramework);
  // `docs_mode: hidden` frameworks have no `/<slug>` page or `/<slug>/quickstart`
  // — surfacing "Continue with X" CTAs that link there would dead-end on a 404.
  // Fall through to the picker (which already filters hidden frameworks) so
  // visitors who somehow landed on a hidden default still get a working entry
  // point into the docs.
  const isHidden = integration
    ? getDocsMode(integration.slug) === "hidden"
    : false;
  if (!integration || isHidden) {
    // Defensive: the registry has dropped the default framework, or the
    // user's effective framework resolves to a hidden one. Rendering
    // the picker as a last resort beats linking to a 404.
    return (
      <FrameworkPicker
        heading="Pick your agent framework"
        description="Pick a backend to continue."
      />
    );
  }

  return (
    <div className="not-prose">
      <section className="mb-10">
        <h2 className="text-xl sm:text-2xl font-semibold text-[var(--text)] mb-2 tracking-tight">
          Continue with {integration.name}
        </h2>
        <p className="text-sm text-[var(--text-secondary)] leading-relaxed mb-5 max-w-2xl">
          We&apos;ll render every code snippet using {integration.name}. Pick up
          where you left off — or switch backends below or from the sidebar.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Link
            href={`/${integration.slug}/quickstart`}
            className="group flex flex-col gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-5 no-underline hover:border-[var(--accent)] transition-colors"
          >
            <div className="flex items-center justify-between">
              <div className="font-semibold text-[var(--text)]">Quickstart</div>
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                className="text-[var(--text-muted)] group-hover:text-[var(--accent)] transition-colors"
              >
                <line x1="5" y1="12" x2="19" y2="12" />
                <polyline points="12 5 19 12 12 19" />
              </svg>
            </div>
            <div className="text-sm text-[var(--text-secondary)] leading-relaxed">
              The {integration.name} quickstart guide.
            </div>
          </Link>
          <Link
            href={`/${integration.slug}`}
            className="group flex flex-col gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-5 no-underline hover:border-[var(--accent)] transition-colors"
          >
            <div className="flex items-center justify-between">
              <div className="font-semibold text-[var(--text)]">
                Browse {integration.name} docs
              </div>
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                className="text-[var(--text-muted)] group-hover:text-[var(--accent)] transition-colors"
              >
                <line x1="5" y1="12" x2="19" y2="12" />
                <polyline points="12 5 19 12 12 19" />
              </svg>
            </div>
            <div className="text-sm text-[var(--text-secondary)] leading-relaxed">
              Every topic rendered with {integration.name} snippets.
            </div>
          </Link>
        </div>
      </section>

      <FrameworkPicker
        heading="Switch backend"
        description="Pick another backend and the rest of the docs will render with its code."
      />
    </div>
  );
}
