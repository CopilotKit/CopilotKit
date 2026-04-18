// Single-variant cell: the default renderer used by the main grid.
// One demo per cell, one row of link badges + one row of status badges.
import { getDemoStatus, healthBadge, qaBadge, testBadge } from "@/lib/status";
import { Badge, HealthDot } from "@/components/badges";
import type { CellContext } from "@/components/feature-grid";

export function SingleCell({
  integration,
  feature,
  hostedUrl,
  bundleStale,
  shellUrl,
}: CellContext) {
  const s = getDemoStatus(integration.slug, feature.id);
  const e2e = testBadge(s?.e2e ?? null, bundleStale);
  const smoke = testBadge(s?.smoke ?? null, bundleStale);
  const qa = qaBadge(s?.qa ?? null, bundleStale);
  const health = healthBadge(
    s?.health ?? { status: "unknown", checked_at: "" },
    bundleStale,
  );
  return (
    <div className="flex flex-col gap-1 text-[11px]">
      <div className="flex items-center gap-2.5">
        <a
          href={`${shellUrl}/integrations/${integration.slug}/${feature.id}/preview`}
          target="_blank"
          rel="noopener noreferrer"
          className="whitespace-nowrap text-[var(--accent)] hover:underline"
        >
          <span className="text-[var(--text-muted)]">Demo</span> <span>↗</span>
        </a>
        <a
          href={`${shellUrl}/integrations/${integration.slug}/${feature.id}/code`}
          target="_blank"
          rel="noopener noreferrer"
          className="whitespace-nowrap text-[var(--accent)] hover:underline"
        >
          <span className="text-[var(--text-muted)]">Code</span>{" "}
          <span>{"</>"}</span>
        </a>
      </div>
      <div className="flex items-center gap-2.5">
        <Badge name="E2E" state={e2e} href={s?.e2e?.url} />
        <Badge name="Smoke" state={smoke} href={s?.smoke?.url} />
        <Badge name="QA" state={qa} href={s?.qa?.url} />
        <HealthDot state={health} href={hostedUrl} />
      </div>
    </div>
  );
}
