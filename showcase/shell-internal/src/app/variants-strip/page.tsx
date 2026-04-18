// Strip: per-signal row of colored chips, one chip per variant.
// Hover a chip to see the variant name; click to open hosted URL.
import { getDemoStatus, getDemoVariants } from "@/lib/status";
import { FeatureGrid, type CellContext } from "@/components/feature-grid";
import { DOT_BG } from "@/components/badges";
import {
  DemoCodeRow,
  SignalRow,
  getSignalTone,
  resolveBadges,
  urlsForVariant,
} from "@/components/variant-pieces";

function StripCell(ctx: CellContext) {
  const s = getDemoStatus(ctx.integration.slug, ctx.feature.id);
  const variants = getDemoVariants(ctx.integration.slug, ctx.feature.id);

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

  const baseLinks = urlsForVariant(ctx, null);

  const renderStrip = (kind: "e2e" | "smoke" | "qa" | "health") => (
    <div className="flex items-center gap-1">
      <span className="text-[10px] text-[var(--text-muted)] w-10">
        {kind === "e2e"
          ? "E2E"
          : kind === "smoke"
            ? "Smoke"
            : kind === "qa"
              ? "QA"
              : "Hlt"}
      </span>
      <div className="flex gap-0.5">
        {variants.map((v) => {
          const tone = getSignalTone(v, ctx.bundleStale, kind);
          const links = urlsForVariant(ctx, v.name);
          const href = kind === "health" ? links.hostedUrl : links.demoUrl;
          return (
            <a
              key={v.name}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              title={`${v.name} · ${kind} · ${tone}`}
              className={`inline-block w-3 h-3 rounded-sm ${DOT_BG[tone]}`}
            />
          );
        })}
      </div>
    </div>
  );

  return (
    <div className="flex flex-col gap-1 text-[11px]">
      <DemoCodeRow links={baseLinks} />
      <div className="flex flex-col gap-0.5">
        {renderStrip("e2e")}
        {renderStrip("smoke")}
        {renderStrip("qa")}
        {renderStrip("health")}
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <FeatureGrid
      title="Feature Matrix · Strip Variants"
      subtitle="One colored chip per variant per signal (hover chip for details)"
      renderCell={StripCell}
      minColWidth={220}
    />
  );
}
