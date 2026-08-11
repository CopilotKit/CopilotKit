"use client";

import { useParams } from "next/navigation";
import { useAgentContext } from "@copilotkit/react-core/v2";
import { FileText } from "lucide-react";
import { useBoard, useKpis, useSeries } from "../data/hooks";
import { useVantageHref } from "../href";
import { DEFAULT_LENS } from "../data/lens";
import { formatValue } from "../data/format";
import { KpiTile } from "../components/charts/kpi-tile";
import { TrendChart } from "../components/charts/trend-chart";
import { BreakdownChart } from "../components/charts/breakdown-chart";
import { WaterfallChart } from "../components/charts/waterfall-chart";
import type { BoardTile, Lens, MetricId } from "../data/types";

/**
 * One section per tile, each fetching for ITS OWN metric/dimension — a board
 * whose tiles disagree on metric or dimension must render that disagreement,
 * not collapse it into whichever tile happened to be first. Each section is
 * its own component (rather than a hook call inside a `.map`) so the number
 * of `useSeries` calls this page makes can vary across renders without
 * breaking the rules of hooks.
 */
function TrendSection({ lens, tile }: { lens: Lens; tile: BoardTile }) {
  const { series } = useSeries(lens, tile.metric, tile.dimension ?? "segment");
  if (!series) return null;
  return (
    <section className="space-y-3 rounded-[var(--radius)] border border-hairline bg-surface p-4">
      <h2 className="text-sm font-semibold text-ink">{tile.label}</h2>
      <TrendChart series={series} />
    </section>
  );
}

function BreakdownSection({ lens, tile }: { lens: Lens; tile: BoardTile }) {
  const dimension = tile.dimension ?? "segment";
  const { series, breakdown } = useSeries(lens, tile.metric, dimension);
  return (
    <section className="space-y-3 rounded-[var(--radius)] border border-hairline bg-surface p-4">
      <h2 className="text-sm font-semibold text-ink">{tile.label}</h2>
      <BreakdownChart rows={breakdown} unit={series?.unit ?? "usd"} />
    </section>
  );
}

function WaterfallSection({ lens, tile }: { lens: Lens; tile: BoardTile }) {
  // computeVarianceWaterfall (server-side) ignores metric/dimension — the
  // waterfall is always plan-vs-actual ARR — so the tile's own metric/
  // dimension only matter here for sharing the fetch key with any sibling
  // trend/breakdown tile requesting the same slice.
  const { waterfall } = useSeries(
    lens,
    tile.metric,
    tile.dimension ?? "segment",
  );
  return (
    <section className="space-y-3 rounded-[var(--radius)] border border-hairline bg-surface p-4">
      <h2 className="text-sm font-semibold text-ink">{tile.label}</h2>
      <WaterfallChart steps={waterfall} unit="usd" />
    </section>
  );
}

export function BoardDetailPage() {
  const vantageHref = useVantageHref();
  // resolvePage matched `boards/<id>`; the id is the last URL segment.
  //
  // `useParams` — NOT `useSkinSegments` — is correct here, and stays correct
  // under `LOCK_SKIN=vantage`. It reads the MATCHED route, and the match always
  // happens against `/[skin]/[[...rest]]`: a locked deploy's prefix-free
  // `/boards/<slug>` is rewritten onto `/vantage/boards/<slug>` by
  // `src/proxy.ts` BEFORE routing, so `params.rest` is `["boards", "<slug>"]`
  // either way. The `[skin]` segment absorbs the prefix, which is exactly what
  // makes params prefix-independent where `usePathname` is not. Same reasoning
  // as keel's DocumentPage / RunDetailPage.
  const params = useParams<{ skin: string; rest?: string[] }>();
  const rest = params?.rest;
  const slug = Array.isArray(rest) ? (rest.at(-1) ?? "") : (rest ?? "");
  const { board, loading } = useBoard(slug);
  const lens = board?.lens ?? DEFAULT_LENS;

  const kpiMetrics = (board?.tiles ?? [])
    .filter((t) => t.kind === "kpi")
    .map((t) => t.metric as MetricId);
  // Ask for the board's OWN kpi metrics, not the default four: a board filed
  // from a deck can carry nrr or magic_number, and a tile whose metric was
  // never computed renders nothing and drops out of the readable too.
  const { kpis } = useKpis(lens, kpiMetrics);
  // Still filtered: with no kpi tiles, useKpis falls back to the default four
  // and this board must show none of them.
  const shown = kpis.filter((k) => kpiMetrics.includes(k.metric));
  const trendTiles = (board?.tiles ?? []).filter((t) => t.kind === "trend");
  const gridTiles = (board?.tiles ?? []).filter(
    (t) => t.kind === "breakdown" || t.kind === "waterfall",
  );

  useAgentContext({
    description:
      "What is visibly on this board detail page: the board's title, whether " +
      "you generated it, the document it came from, its tiles and their figures.",
    value: JSON.stringify({
      page: "Board detail",
      board: board?.title ?? null,
      url: board ? vantageHref(`boards/${board.slug}`) : null,
      generated: board?.origin === "generated",
      fromDocument: board?.sourceDocument ?? null,
      why: board?.note ?? null,
      notes: board?.notes ?? [],
      tiles: shown.map((k) => ({
        label: k.label,
        value: formatValue(k.value, k.unit, { compact: true }),
      })),
    }),
  });

  if (loading) {
    return <div className="text-sm text-ink-muted">Loading board…</div>;
  }
  if (!board) {
    return (
      <div className="text-sm text-ink-muted">That board no longer exists.</div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="space-y-2">
        <h1 className="text-xl font-semibold tracking-tight text-ink">
          {board.title}
        </h1>
        <p className="text-sm text-ink-muted">{board.summary}</p>
        <div className="flex flex-wrap items-center gap-2">
          {board.sourceDocument && (
            <span className="flex items-center gap-1.5 rounded bg-surface-muted px-2 py-1 text-[11px] text-ink-muted">
              <FileText className="h-3 w-3" />
              Built from {board.sourceDocument}
            </span>
          )}
          {/* The "why it looks like this" chip. Phase 1 leaves `note` unset; beat
              4 fills it with the recalled preference the agent applied. */}
          {board.note && (
            <span className="rounded bg-brand-soft px-2 py-1 text-[11px] font-medium text-brand">
              {board.note}
            </span>
          )}
        </div>
      </header>

      {shown.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {shown.map((kpi) => (
            <KpiTile key={kpi.metric} kpi={kpi} />
          ))}
        </div>
      )}

      {trendTiles.length > 0 && (
        <div className="space-y-6">
          {trendTiles.map((tile, i) => (
            <TrendSection
              key={`trend-${i}-${tile.metric}-${tile.dimension ?? ""}`}
              lens={lens}
              tile={tile}
            />
          ))}
        </div>
      )}

      {gridTiles.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-2">
          {gridTiles.map((tile, i) =>
            tile.kind === "breakdown" ? (
              <BreakdownSection
                key={`breakdown-${i}-${tile.metric}-${tile.dimension ?? ""}`}
                lens={lens}
                tile={tile}
              />
            ) : (
              <WaterfallSection
                key={`waterfall-${i}-${tile.metric}-${tile.dimension ?? ""}`}
                lens={lens}
                tile={tile}
              />
            ),
          )}
        </div>
      )}

      {board.notes.length > 0 && (
        <section className="space-y-2 rounded-[var(--radius)] border border-hairline bg-surface p-4">
          <h2 className="text-sm font-semibold text-ink">Notes</h2>
          <ul className="space-y-1.5">
            {board.notes.map((note, i) => (
              <li key={i} className="text-sm text-ink-muted">
                {note}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

export default BoardDetailPage;
