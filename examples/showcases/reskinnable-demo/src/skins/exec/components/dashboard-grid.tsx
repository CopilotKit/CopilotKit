"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, X } from "lucide-react";
import {
  A2UIProvider,
  A2UIRenderer,
  useA2UIActions,
} from "@copilotkit/a2ui-renderer";
import { catalog } from "@/skins/exec/catalog";
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
 * Mounts its OWN `<A2UIProvider catalog={catalog}>`, page-owned rather than
 * shared with the chat canvas surface: a dashboard's pinned blocks are a
 * different set of surfaces (`block:<blockId>`, one per pinned block) than
 * whatever the agent is drafting in-chat, and giving them their own provider
 * means a block can never collide with — or be clobbered by — the canvas's
 * surface state.
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
    <A2UIProvider catalog={catalog}>
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
    </A2UIProvider>
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

/** One pinned block's card chrome: remove/move controls wrapping its A2UI surface. */
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

  return (
    <div className="rounded-2xl border border-hairline bg-surface shadow-soft">
      <div className="flex items-center justify-between gap-2 border-b border-hairline px-3 py-2">
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
      <div className="p-4 md:p-6">
        {error !== null && (
          <p role="alert" className="mb-3 text-xs text-negative">
            {title}: {error}
          </p>
        )}
        {surfaceId ? (
          <>
            <SurfaceMessageProcessor operations={ops} surfaceId={surfaceId} />
            <A2UIRenderer surfaceId={surfaceId} />
          </>
        ) : (
          <p role="alert" className="text-sm text-negative">
            {title}: block has no A2UI surface to render.
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * Feeds one block's operations into the A2UI provider. The ledger snapshot
 * carries the FULL operation list on every read, so this strips a duplicate
 * `createSurface` once the surface already exists (the MessageProcessor
 * throws on it) and skips re-processing an identical op list. Copied from
 * the banking skin's canvas-surface `SurfaceMessageProcessor` — same hash-ref
 * guard, same duplicate-`createSurface` strip — the only difference is that
 * the ops here come straight off `block.ops` rather than out of an agent
 * activity message.
 */
function SurfaceMessageProcessor({
  operations,
  surfaceId,
}: {
  operations: A2UIOp[];
  surfaceId: string;
}) {
  const { processMessages, getSurface } = useA2UIActions();
  const lastHashRef = useRef("");

  useEffect(() => {
    if (!operations.length) return;
    const hash = JSON.stringify(operations);
    if (hash === lastHashRef.current) return;
    lastHashRef.current = hash;

    const isExisting = !!getSurface(surfaceId);
    const ops = isExisting
      ? operations.filter((op) => !("createSurface" in op))
      : operations;
    if (!ops.length) return;
    try {
      processMessages(ops as Array<Record<string, unknown>>);
    } catch (err) {
      console.warn("[exec-dashboard-grid] processMessages threw:", err);
    }
  }, [operations, processMessages, getSurface, surfaceId]);

  return null;
}

export default DashboardGrid;
