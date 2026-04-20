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

// Keep in sync with the registry's canonical category ordering. Mirrors
// the ordering used on the integrations page so the selector panel
// reads the same everywhere.
const INTEGRATION_CATEGORY_IDS = [
  "popular",
  "agent-framework",
  "provider-sdk",
  "enterprise-platform",
  "protocol",
  "emerging",
  "starter",
] as const;

export function SidebarFrameworkSelector() {
  const options = getIntegrations()
    .slice()
    .sort((a, b) => (a.sort_order ?? 999) - (b.sort_order ?? 999))
    .map((i) => ({
      slug: i.slug,
      name: i.name,
      category: i.category ?? "other",
      logo: i.logo ?? null,
      deployed: i.deployed,
    }));

  const categoryOrder = INTEGRATION_CATEGORY_IDS.map((id) => ({
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
