// Stacked variants: each variant gets its own full mini-row inside the cell.
import { FeatureGrid, type CellContext } from "@/components/feature-grid";
import { getDemoStatus, getDemoVariants } from "@/lib/status";
import {
  DemoCodeRow,
  SignalRow,
  resolveBadges,
  urlsForVariant,
} from "@/components/variant-pieces";

function StackCell(ctx: CellContext) {
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

  return (
    <div className="flex flex-col gap-2 text-[11px]">
      {variants.map((v) => {
        const badges = resolveBadges(v, ctx.bundleStale, s);
        const links = urlsForVariant(ctx, v.name);
        return (
          <div
            key={v.name}
            className="flex flex-col gap-0.5 pl-2 border-l-2 border-[var(--border)]"
          >
            <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)]">
              {v.name}
            </div>
            <DemoCodeRow links={links} />
            <SignalRow {...badges} links={links} />
          </div>
        );
      })}
    </div>
  );
}

export default function Page() {
  return (
    <FeatureGrid
      title="Feature Matrix · Stacked Variants"
      subtitle="Each variant shown as its own mini-row inside the cell"
      renderCell={StackCell}
      minColWidth={240}
    />
  );
}
