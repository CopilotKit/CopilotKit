"use client";
// Tabbed variants: small tabs at the top of the cell, one variant body at a time.
import { useState } from "react";
import { FeatureGrid, type CellContext } from "@/components/feature-grid";
import { getDemoStatus, getDemoVariants } from "@/lib/status";
import {
  DemoCodeRow,
  SignalRow,
  resolveBadges,
  urlsForVariant,
} from "@/components/variant-pieces";

function TabsCell(ctx: CellContext) {
  const s = getDemoStatus(ctx.integration.slug, ctx.feature.id);
  const variants = getDemoVariants(ctx.integration.slug, ctx.feature.id);

  const tabs =
    variants && variants.length > 0 ? variants.map((v) => v.name) : [null];
  const [active, setActive] = useState(0);

  const activeVariant = variants?.[active] ?? null;
  const activeName = tabs[active];
  const badges = resolveBadges(activeVariant, ctx.bundleStale, s);
  const links = urlsForVariant(ctx, activeName);

  return (
    <div className="flex flex-col gap-1 text-[11px]">
      {tabs.length > 1 && (
        <div className="flex items-center gap-1 -ml-1">
          {tabs.map((name, i) => (
            <button
              key={name ?? "default"}
              onClick={() => setActive(i)}
              className={`px-1.5 py-0.5 rounded text-[10px] font-mono ${
                i === active
                  ? "bg-[var(--bg-hover)] text-[var(--text)]"
                  : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
              }`}
            >
              {name}
            </button>
          ))}
        </div>
      )}
      <DemoCodeRow links={links} />
      <SignalRow {...badges} links={links} />
    </div>
  );
}

export default function Page() {
  return (
    <FeatureGrid
      title="Feature Matrix · Tabbed Variants"
      subtitle="Click a tab to switch variant"
      renderCell={TabsCell}
      minColWidth={220}
    />
  );
}
