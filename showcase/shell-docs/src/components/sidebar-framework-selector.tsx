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
import { FRAMEWORK_CATEGORY_ORDER } from "@/lib/docs-render";

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
    // sidebars. The wrapper bg matches the sidebar surface so the area
    // surrounding the pill reads as one continuous panel.
    <div className="sticky top-0 z-10 bg-[var(--bg-surface)] backdrop-blur-lg">
      <FrameworkSelector
        options={options}
        categoryOrder={categoryOrder}
        variant="sidebar"
      />
    </div>
  );
}
