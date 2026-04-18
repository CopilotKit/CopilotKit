// Mini-matrix: rows = variants, columns = signals.
import {
  healthBadge,
  qaBadge,
  testBadge,
  getDemoStatus,
  getDemoVariants,
} from "@/lib/status";
import { FeatureGrid, type CellContext } from "@/components/feature-grid";
import { DOT_BG, TONE_CLASS } from "@/components/badges";
import {
  DemoCodeRow,
  SignalRow,
  resolveBadges,
  urlsForVariant,
} from "@/components/variant-pieces";

function GridCell(ctx: CellContext) {
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
    <div className="text-[10px]">
      <table className="border-collapse">
        <thead>
          <tr className="text-[var(--text-muted)]">
            <th className="text-left pr-2 font-mono uppercase tracking-wider text-[9px] pb-0.5"></th>
            <th className="text-left px-1 font-normal pb-0.5">Demo</th>
            <th className="text-left px-1 font-normal pb-0.5">Code</th>
            <th className="text-left px-1 font-normal pb-0.5">E2E</th>
            <th className="text-left px-1 font-normal pb-0.5">Smoke</th>
            <th className="text-left px-1 font-normal pb-0.5">QA</th>
            <th className="text-left px-1 font-normal pb-0.5">Hlt</th>
          </tr>
        </thead>
        <tbody>
          {variants.map((v) => {
            const e2e = testBadge(v.e2e, ctx.bundleStale);
            const smoke = testBadge(v.smoke, ctx.bundleStale);
            const qa = qaBadge(v.qa, ctx.bundleStale);
            const health = healthBadge(v.health, ctx.bundleStale);
            const links = urlsForVariant(ctx, v.name);
            return (
              <tr key={v.name} className="hover:bg-[var(--bg-hover)]">
                <td className="text-left pr-2 font-mono text-[var(--text-muted)]">
                  {v.name}
                </td>
                <td className="text-left px-1">
                  <a
                    href={links.demoUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[var(--accent)] hover:underline"
                  >
                    ↗
                  </a>
                </td>
                <td className="text-left px-1">
                  <a
                    href={links.codeUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[var(--accent)] hover:underline"
                  >
                    {"</>"}
                  </a>
                </td>
                <td
                  className={`text-left px-1 tabular-nums ${TONE_CLASS[e2e.tone]}`}
                >
                  {e2e.label}
                </td>
                <td
                  className={`text-left px-1 tabular-nums ${TONE_CLASS[smoke.tone]}`}
                >
                  {smoke.label}
                </td>
                <td
                  className={`text-left px-1 tabular-nums ${TONE_CLASS[qa.tone]}`}
                >
                  {qa.label}
                </td>
                <td className="text-left px-1">
                  <a
                    href={links.hostedUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <span
                      className={`inline-block w-2 h-2 rounded-full ${DOT_BG[health.tone]}`}
                    />
                  </a>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function Page() {
  return (
    <FeatureGrid
      title="Feature Matrix · Mini-grid Variants"
      subtitle="Each cell is a mini table: rows = variants, cols = signals"
      renderCell={GridCell}
      minColWidth={280}
    />
  );
}
