"use client";
// Aggregate variants: one worst-case rollup + "N variants" count +
// hover to see per-variant details in a popover.
import { useState } from "react";
import {
  type BadgeTone,
  getDemoStatus,
  getDemoVariants,
  passCount,
} from "@/lib/status";
import { FeatureGrid, type CellContext } from "@/components/feature-grid";
import {
  DemoCodeRow,
  SignalRow,
  resolveBadges,
  urlsForVariant,
} from "@/components/variant-pieces";
import { DOT_BG, TONE_CLASS } from "@/components/badges";

function countLabel(
  pass: number,
  total: number,
): {
  label: string;
  tone: BadgeTone;
} {
  if (total === 0) return { label: "—", tone: "gray" };
  if (pass === total) return { label: `${pass}/${total} ✓`, tone: "green" };
  if (pass === 0) return { label: `0/${total}`, tone: "red" };
  return { label: `${pass}/${total}`, tone: "amber" };
}

function AggregateCell(ctx: CellContext) {
  const s = getDemoStatus(ctx.integration.slug, ctx.feature.id);
  const variants = getDemoVariants(ctx.integration.slug, ctx.feature.id);
  const [open, setOpen] = useState(false);

  if (!variants || variants.length === 0) {
    const badges = resolveBadges(null, ctx.bundleStale, s);
    const links = urlsForVariant(ctx, null);
    return (
      <div className="flex flex-col gap-1 text-[11px]">
        <DemoCodeRow links={links} />
        <SignalRow {...badges} links={links} />
      </div>
    );
  }

  const e2e = passCount(variants, ctx.bundleStale, "e2e");
  const smoke = passCount(variants, ctx.bundleStale, "smoke");
  const qa = passCount(variants, ctx.bundleStale, "qa");
  const health = passCount(variants, ctx.bundleStale, "health");
  const links = urlsForVariant(ctx, null);

  const e2eLabel = countLabel(e2e.pass, e2e.total);
  const smokeLabel = countLabel(smoke.pass, smoke.total);
  const qaLabel = countLabel(qa.pass, qa.total);
  const healthLabel = countLabel(health.pass, health.total);

  return (
    <div className="relative flex flex-col gap-1 text-[11px]">
      <div className="flex items-center justify-between">
        <DemoCodeRow links={links} />
        <button
          onClick={() => setOpen((o) => !o)}
          className="text-[10px] font-mono text-[var(--text-muted)] hover:text-[var(--accent)]"
        >
          {variants.length} variants {open ? "▴" : "▾"}
        </button>
      </div>
      <div className="flex items-center gap-2.5">
        <span className="whitespace-nowrap">
          <span className="text-[var(--text-muted)]">E2E</span>{" "}
          <span className={`tabular-nums ${TONE_CLASS[e2eLabel.tone]}`}>
            {e2eLabel.label}
          </span>
        </span>
        <span className="whitespace-nowrap">
          <span className="text-[var(--text-muted)]">Smoke</span>{" "}
          <span className={`tabular-nums ${TONE_CLASS[smokeLabel.tone]}`}>
            {smokeLabel.label}
          </span>
        </span>
        <span className="whitespace-nowrap">
          <span className="text-[var(--text-muted)]">QA</span>{" "}
          <span className={`tabular-nums ${TONE_CLASS[qaLabel.tone]}`}>
            {qaLabel.label}
          </span>
        </span>
        <span className="inline-flex items-center gap-1 whitespace-nowrap">
          <span
            className={`inline-block w-2 h-2 rounded-full ${DOT_BG[healthLabel.tone]}`}
          />
          <span className={`tabular-nums ${TONE_CLASS[healthLabel.tone]}`}>
            {healthLabel.label}
          </span>
        </span>
      </div>
      {open && (
        <div className="absolute z-50 top-full left-0 mt-1 bg-[var(--bg-surface)] border border-[var(--border)] rounded-md shadow-lg p-2 min-w-[300px]">
          <div className="flex flex-col gap-1.5">
            {variants.map((v) => {
              const badges = resolveBadges(v, ctx.bundleStale, s);
              const vlinks = urlsForVariant(ctx, v.name);
              return (
                <div
                  key={v.name}
                  className="flex flex-col gap-0.5 pb-1.5 border-b border-[var(--border)] last:border-b-0 last:pb-0"
                >
                  <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)]">
                    {v.name}
                  </div>
                  <SignalRow {...badges} links={vlinks} />
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export default function Page() {
  return (
    <FeatureGrid
      title="Feature Matrix · Aggregate Variants"
      subtitle="Rollup with pass/total counts; click the variants toggle to drill down"
      renderCell={AggregateCell}
      minColWidth={240}
    />
  );
}
