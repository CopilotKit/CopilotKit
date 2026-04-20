// SidebarFrameworkSelector — server component that resolves the list of
// framework options from the registry and renders the client-side
// <FrameworkSelector /> with the `sidebar` variant.
//
// Mounted at the TOP of every docs sidebar (both `/docs/...` and
// `/<framework>/...`) so the "agentic backend" pivot is always visible
// — matching the docs.copilotkit.ai reference, where the selector is
// the sidebar's header element.

import React from "react";
import { FrameworkSelector } from "./framework-selector";
import { getIntegrations, getCategoryLabel } from "@/lib/registry";

// Canonical category ordering for framework pickers. Mirrors the
// ordering used on the integrations page so the selector panel reads
// the same everywhere.
//
// TODO(registry): promote this to `@/lib/registry` alongside
// getCategoryLabel so the `/` landing grid and this sidebar dropdown
// share a single source of truth. Leaving in place for now because the
// registry module is owned by a parallel refactor.
const FRAMEWORK_CATEGORY_ORDER = [
  "popular",
  "agent-framework",
  "provider-sdk",
  "enterprise-platform",
  "protocol",
  "emerging",
  "starter",
] as const;

export function SidebarFrameworkSelector() {
  // Sort by explicit sort_order, falling back to alphabetical slug for
  // stability when multiple integrations share the default. Array#sort
  // is not guaranteed stable across engines for ties, so we make the
  // tiebreak explicit — otherwise "soon" integrations shuffle between
  // renders on builds using different V8 revisions.
  const options = getIntegrations()
    .slice()
    .sort((a, b) => {
      const ao = a.sort_order ?? 999;
      const bo = b.sort_order ?? 999;
      if (ao !== bo) return ao - bo;
      return a.slug.localeCompare(b.slug);
    })
    .map((i) => ({
      slug: i.slug,
      name: i.name,
      category: i.category ?? "other",
      logo: i.logo ?? null,
      deployed: i.deployed,
    }));

  const categoryOrder = FRAMEWORK_CATEGORY_ORDER.map((id) => ({
    id,
    name: getCategoryLabel(id),
  }));

  return (
    // Sticky so the selector stays visible as the user scrolls long
    // sidebars. The background + padding matches the sidebar surface so
    // content scrolling behind it doesn't bleed through.
    <div className="sticky top-0 z-10 -mx-4 px-4 pt-4 pb-3 bg-[var(--bg)] border-b border-[var(--border-dim)] mb-3">
      <FrameworkSelector
        options={options}
        categoryOrder={categoryOrder}
        variant="sidebar"
      />
    </div>
  );
}
