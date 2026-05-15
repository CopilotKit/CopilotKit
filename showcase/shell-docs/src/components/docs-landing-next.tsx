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
import { FRAMEWORK_CATEGORY_ORDER } from "@/lib/framework-categories";
import {
  getCategoryLabel,
  getIntegration,
  getIntegrations,
  type Integration,
} from "@/lib/registry";

function FrameworkPicker({
  heading,
  description,
}: {
  heading: string;
  description: string;
}) {
  // Drop Built-in Agent: it's the soft-default the page is already
  // rendering as, so showing it under "Switch backend" would just be a
  // no-op tile.
  const integrations = getIntegrations()
    .filter((i) => i.slug !== "built-in-agent")
    .sort((a, b) => (a.sort_order ?? 999) - (b.sort_order ?? 999));

  // Bucket integrations by category, honoring the canonical ordering.
  const buckets = new Map<string, Integration[]>();
  for (const cat of FRAMEWORK_CATEGORY_ORDER) buckets.set(cat, []);
  buckets.set("other", []);
  for (const i of integrations) {
    const key = buckets.has(i.category) ? i.category : "other";
    buckets.get(key)!.push(i);
  }

  return (
    <section className="not-prose">
      <h2 className="text-xl font-semibold text-[var(--text)] mb-1">
        {heading}
      </h2>
      <p className="text-sm text-[var(--text-secondary)] mb-5">{description}</p>
      {[...buckets.entries()].map(([catId, items]) => {
        if (items.length === 0) return null;
        const label = catId === "other" ? "Other" : getCategoryLabel(catId);
        return (
          <div key={catId} className="mb-6">
            <div className="text-[10px] font-mono uppercase tracking-widest text-[var(--text-faint)] mb-3">
              {label}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {items.map((i) => (
                <Link
                  key={i.slug}
                  href={`/${i.slug}`}
                  className="group relative flex items-center gap-2 p-3 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] hover:border-[var(--accent)] hover:shadow-sm transition-all"
                >
                  <FrameworkLogo
                    slug={i.slug}
                    fallbackSrc={i.logo}
                    size={20}
                    className="shrink-0 text-[var(--text-secondary)] group-hover:text-[var(--accent)]"
                  />
                  <span className="flex-1 min-w-0 truncate text-sm font-medium text-[var(--text)] group-hover:text-[var(--accent)]">
                    {i.name}
                  </span>
                  <StoredFrameworkHighlight slug={i.slug} />
                </Link>
              ))}
            </div>
          </div>
        );
      })}
    </section>
  );
}

export function DocsLandingNext() {
  const { effectiveFramework } = useFramework();

  const integration = getIntegration(effectiveFramework);
  if (!integration) {
    // Defensive: the registry has dropped the default framework. Should
    // not happen — DEFAULT_FRAMEWORK is a known slug — but rendering
    // the picker as a last resort beats throwing.
    return (
      <FrameworkPicker
        heading="Pick your agent framework"
        description="Pick a backend to continue."
      />
    );
  }

  return (
    <div className="not-prose">
      <h2 className="text-xl font-semibold text-[var(--text)] mb-2">
        Continue with {integration.name}
      </h2>
      <p className="text-sm text-[var(--text-secondary)] leading-relaxed mb-5">
        We&apos;ll render every code snippet using {integration.name}. Pick up
        where you left off — or switch backends below or from the sidebar.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-10">
        <Link
          href={`/${integration.slug}/quickstart`}
          className="group flex flex-col gap-1 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-4 no-underline hover:border-[var(--accent)] hover:shadow-sm transition"
        >
          <div className="font-semibold text-[var(--text)] group-hover:text-[var(--accent)]">
            Quickstart
          </div>
          <div className="text-sm text-[var(--text-secondary)] leading-relaxed">
            The {integration.name} quickstart guide.
          </div>
        </Link>
        <Link
          href={`/${integration.slug}`}
          className="group flex flex-col gap-1 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-4 no-underline hover:border-[var(--accent)] hover:shadow-sm transition"
        >
          <div className="font-semibold text-[var(--text)] group-hover:text-[var(--accent)]">
            Browse {integration.name} docs
          </div>
          <div className="text-sm text-[var(--text-secondary)] leading-relaxed">
            Every topic rendered with {integration.name} snippets.
          </div>
        </Link>
      </div>

      <FrameworkPicker
        heading="Switch backend"
        description="Pick another backend and the rest of the docs will render with its code."
      />
    </div>
  );
}
