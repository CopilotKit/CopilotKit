// Feature matrix: one row per feature × integration. Each feature's
// `kind` (primary | testing) determines its visual grouping.
// "testing"-kind features render muted and skip the docs row.
import { healthBadge, qaBadge, testBadge, getDemoStatus } from "@/lib/status";
import { FeatureGrid, type CellContext } from "@/components/feature-grid";
import { Badge, HealthDot } from "@/components/badges";
import { DocsRow, urlsFor } from "@/components/cell-pieces";

function Cell(ctx: CellContext) {
  const isTesting = ctx.feature.kind === "testing";
  const s = getDemoStatus(ctx.integration.slug, ctx.feature.id);
  const e2e = testBadge(s?.e2e ?? null, ctx.bundleStale);
  const smoke = testBadge(s?.smoke ?? null, ctx.bundleStale);
  const qa = qaBadge(s?.qa ?? null, ctx.bundleStale);
  const health = healthBadge(
    s?.health ?? { status: "unknown", checked_at: "" },
    ctx.bundleStale,
  );
  const links = urlsFor(ctx);

  return (
    <div
      className={`flex flex-col gap-1 text-[11px] ${isTesting ? "opacity-60" : ""}`}
    >
      <div className="flex items-center gap-2.5">
        <a
          href={links.demoUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="whitespace-nowrap text-[var(--accent)] hover:underline"
        >
          <span className="text-[var(--text-muted)]">Demo</span> <span>↗</span>
        </a>
        <a
          href={links.codeUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="whitespace-nowrap text-[var(--accent)] hover:underline"
        >
          <span className="text-[var(--text-muted)]">Code</span>{" "}
          <span>{"</>"}</span>
        </a>
      </div>
      {!isTesting && <DocsRow feature={ctx.feature} shellUrl={ctx.shellUrl} />}
      <div className="flex items-center gap-2.5">
        <Badge name="E2E" state={e2e} href={s?.e2e?.url} />
        <Badge name="Smoke" state={smoke} href={s?.smoke?.url} />
        <Badge name="QA" state={qa} href={s?.qa?.url} />
        <HealthDot state={health} href={links.hostedUrl} />
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <>
      <FeatureGrid title="Feature Matrix" renderCell={Cell} minColWidth={260} />
      <Legend />
    </>
  );
}

function Legend() {
  return (
    <div className="px-8 pb-8 mt-4 flex flex-wrap gap-x-6 gap-y-2 text-xs text-[var(--text-muted)]">
      <div className="flex items-center gap-1.5">
        <span className="text-[var(--text-secondary)]">testing</span>
        rows are muted &amp; hide docs (primary feature = has docs)
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-[var(--ok)]">docs-og ✓</span>/
        <span className="text-[var(--danger)]">docs-shell ✗</span>
        doc link present / missing
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-[var(--accent)] font-medium">Demo ↗</span>/
        <span className="text-[var(--accent)] font-medium">Code {"</>"}</span>
        open hosted preview / source
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-[var(--ok)]">E2E ✓</span>/
        <span className="text-[var(--amber)]">amber</span>/
        <span className="text-[var(--danger)]">✗</span>
        end-to-end (green &lt;6h · amber older · red fail/none)
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-[var(--ok)]">Smoke ✓</span>
        smoke test, same color rules
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-[var(--ok)]">QA 3d</span>
        days since human QA (green &lt;7d · amber &lt;30d · red older/never)
      </div>
      <div className="flex items-center gap-1.5">
        <span className="inline-flex items-center gap-1">
          <span className="inline-block w-2 h-2 rounded-full bg-[var(--ok)]" />
          Hosted
        </span>
        dot = live probe, click = open hosted URL
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-[var(--text-muted)]">?</span>
        status bundle is stale
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-[var(--text-muted)]">—</span>
        supported, no demo yet
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-[var(--danger)]">✗</span>
        not supported
      </div>
    </div>
  );
}
