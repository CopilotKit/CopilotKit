"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, X } from "lucide-react";
import { PageSurface } from "@/shell/generative-ui/page-surface";
import { useExecLedger } from "@/skins/exec/data/ledger-context";
import type { ExecLedgerDashboard } from "@/skins/exec/data/ledger-context";
import { extractSurfaceId } from "@/skins/exec/blocks/build-block-ops";
import type { A2UIOp } from "@/skins/exec/blocks/build-block-ops";
import type { DashboardId } from "@/skins/exec/data/types";

/**
 * The exec skin's pinned-block dashboard grid — the component the CEO/CFO pages mount.
 *
 * Reads its dashboard straight off `useExecLedger()`'s `ExecLedgerSnapshot`:
 * every block already comes enriched with `ops`, the A2UI operations the
 * ledger GET route derives deterministically from the block's `spec` (see
 * `../blocks/build-block-ops`'s doc comment). There is no separate "fetch this
 * block's ops" round trip — the ledger snapshot IS the data source.
 *
 * Each `BlockCard` renders its block through its own `<PageSurface>` target
 * (`dashboard:<surfaceId>`, one per pinned block), in the provider's surface
 * manager — the skin's generative UI (`skin.catalog`, handed to
 * `CopilotKitProvider` as `generativeUI={{ ui }}`) renders it. The targets are
 * not shared with the chat either: whatever the agent is drafting in-chat
 * renders under `inline:<surfaceId>`, so a block can never collide with, or be
 * clobbered by, the chat's or the canvas's surface state.
 *
 * Does NOT mount a `BlockDataProvider`. `ExecProviders` (`../providers.tsx`)
 * already mounts one — via its `BlockDataBridge`, adapting `useExecLedger()`
 * down to `BlockData` (`../block-data.tsx`) — ABOVE everything, including this
 * grid, so the catalog renderers' `useBlockData()` resolves from that single,
 * already-mounted instance. A second provider here would just shadow it for
 * no benefit.
 */
export function DashboardGrid({ dashboardId }: { dashboardId: DashboardId }) {
  const { snapshot, removeBlock, moveBlock } = useExecLedger();
  // `snapshot.dashboards` always carries both `ceo` and `cfo` keys (see the
  // ledger context's `EMPTY` fallback), so this is never undefined for a
  // valid `DashboardId`.
  const dashboard: ExecLedgerDashboard = snapshot.dashboards[dashboardId];

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      {dashboard.blocks.length === 0 ? (
        <EmptyState />
      ) : (
        dashboard.blocks.map((block, index) => (
          <BlockCard
            key={block.id}
            dashboardId={dashboardId}
            blockId={block.id}
            title={block.spec.title}
            ops={block.ops}
            isFirst={index === 0}
            isLast={index === dashboard.blocks.length - 1}
            onRemove={removeBlock}
            onMove={moveBlock}
          />
        ))
      )}
    </div>
  );
}

/**
 * LOUD failure line for a block whose ops the browser rejected, rendered above
 * that block's surface. Left unread, a rejected op list shows up as a silently
 * empty card. Per card, because each card renders its own target.
 *
 * Names the block from the GRID's own context (`title`): the validator's
 * reason names a component or an op, not the block.
 */
function SurfaceProcessingError({
  title,
  reason,
}: {
  title: string;
  reason: string;
}) {
  return (
    <p role="alert" className="mb-3 text-xs text-negative">
      {title}: this block could not be rendered — {reason}
    </p>
  );
}

/** The explicit "nothing pinned" state — never render nothing here. */
function EmptyState() {
  return (
    <div
      role="status"
      className="col-span-full rounded-2xl border border-dashed border-hairline bg-surface-muted p-8 text-center text-sm text-ink-muted"
    >
      No blocks pinned yet — ask Vantage for a metric and pin it.
    </div>
  );
}

interface BlockCardProps {
  dashboardId: DashboardId;
  blockId: string;
  title: string;
  ops: A2UIOp[];
  isFirst: boolean;
  isLast: boolean;
  onRemove: (dashboardId: DashboardId, blockId: string) => Promise<void>;
  onMove: (
    dashboardId: DashboardId,
    blockId: string,
    direction: "up" | "down",
  ) => Promise<void>;
}

/**
 * One pinned block's card chrome: remove/move controls wrapping its surface.
 *
 * Renders its OWN `<PageSurface>` target, one per block — the same call the
 * shell's inline block card makes (`src/shell/chat/inline-block-surface.tsx`),
 * so each block's rejected ops are reported on the block they belong to. The
 * ledger serves the block's A2UI v0.9 ops; `<PageSurface>` hands them to the
 * surface manager as A2UI 1.0.
 */
function BlockCard({
  dashboardId,
  blockId,
  title,
  ops,
  isFirst,
  isLast,
  onRemove,
  onMove,
}: BlockCardProps) {
  const surfaceId = extractSurfaceId(ops);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      // Loud: a remove/move that failed must never look like it succeeded —
      // the block chrome stays put and says why.
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const iconButtonClass =
    "rounded-full border border-hairline bg-surface p-1.5 text-ink-muted transition hover:bg-surface-muted hover:text-ink disabled:cursor-not-allowed disabled:opacity-40";

  // `h-full` + a column flex: the grid stretches every item to its row's
  // height (the default `items-stretch`), and this makes the card actually USE
  // that height instead of leaving the taller neighbour's slack outside its
  // border. The header keeps its intrinsic height; the body takes the rest, so
  // two cards side by side line up top AND bottom.
  return (
    <div className="flex h-full flex-col rounded-2xl border border-hairline bg-surface shadow-soft">
      <div className="flex flex-none items-center justify-between gap-2 border-b border-hairline px-3 py-2">
        <span className="min-w-0 truncate text-xs font-medium uppercase tracking-[0.1em] text-ink-muted">
          {title}
        </span>
        <div className="flex flex-none items-center gap-1">
          <button
            type="button"
            aria-label={`Move ${title} up`}
            disabled={busy || isFirst}
            className={iconButtonClass}
            onClick={() => void run(() => onMove(dashboardId, blockId, "up"))}
          >
            <ArrowUp className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            aria-label={`Move ${title} down`}
            disabled={busy || isLast}
            className={iconButtonClass}
            onClick={() => void run(() => onMove(dashboardId, blockId, "down"))}
          >
            <ArrowDown className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            aria-label={`Remove ${title}`}
            disabled={busy}
            className={iconButtonClass}
            onClick={() => void run(() => onRemove(dashboardId, blockId))}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <div className="flex-1 p-4 md:p-6">
        {error !== null && (
          <p role="alert" className="mb-3 text-xs text-negative">
            {title}: {error}
          </p>
        )}
        {surfaceId ? (
          <PageSurface
            target={`dashboard:${surfaceId}`}
            operations={ops}
            renderRejected={(reasons) => (
              <SurfaceProcessingError title={title} reason={reasons[0]} />
            )}
          />
        ) : (
          <p role="alert" className="text-sm text-negative">
            {title}: block has no A2UI surface to render.
          </p>
        )}
      </div>
    </div>
  );
}

export default DashboardGrid;
