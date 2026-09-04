"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, X } from "lucide-react";
import {
  A2UIProvider,
  A2UIRenderer,
  useA2UIActions,
  useA2UIError,
  useA2UIState,
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
 * Mounts NO `A2UIProvider` of its own: each `BlockCard` mounts its own, one
 * per pinned block (see the note there). Page-level state is deliberately not
 * shared with the chat canvas surface either — a dashboard's pinned blocks are
 * a different set of surfaces (`block:<blockId>`, one per pinned block) than
 * whatever the agent is drafting in-chat, so a block can never collide with,
 * or be clobbered by, the canvas's surface state.
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
 * LOUD failure line for a block whose ops the A2UI MessageProcessor rejected,
 * rendered above that block's surface. The provider swallows the throw and
 * exposes it through `useA2UIError()`; left unread, a rejected op list shows
 * up as a silently empty card.
 *
 * PER-CARD, because the provider is per-card. A grid-wide provider has ONE
 * error slot, and the provider clears it on every successful `processMessages`
 * — so any sibling block's success wiped the failing block's banner and the
 * failed card sat silently blank.
 *
 * Names the block from the GRID's own context (`title`) rather than trusting
 * the provider's message to do it: of the MessageProcessor's rejection
 * messages only "Surface not found for message: <id>" and "Surface <id>
 * already exists" name a surface — "Catalog not found", "Component '<c>' is
 * missing an 'id'", "Cannot create component <id> without a type" and
 * "Message contains multiple update types" do not.
 */
function SurfaceProcessingError({ title }: { title: string }) {
  const error = useA2UIError();
  if (error === null) return null;
  return (
    <p role="alert" className="mb-3 text-xs text-negative">
      {title}: this block could not be rendered — {error}
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
 * One pinned block's card chrome: remove/move controls wrapping its A2UI surface.
 *
 * Mounts its OWN `<A2UIProvider catalog={catalog}>`, one per block — the same
 * call the shell's inline block card makes (`src/shell/chat/inline-block-surface.tsx`).
 * A single grid-wide provider cannot report per-block outcomes: its error slot
 * is shared (any block's success clears every block's error) and so is its
 * `version` counter (a sibling's successful `processMessages` bumps it, which
 * would read as THIS block's rejected op list having applied). One provider per
 * block makes both signals belong to the block they describe.
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
          <A2UIProvider catalog={catalog}>
            <SurfaceMessageProcessor operations={ops} surfaceId={surfaceId} />
            <SurfaceProcessingError title={title} />
            <A2UIRenderer surfaceId={surfaceId} />
          </A2UIProvider>
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
 * rejects it) and skips re-processing an identical op list. Copied from
 * the banking skin's canvas-surface `SurfaceMessageProcessor` — same hash-ref
 * guard, same duplicate-`createSurface` strip — the only difference is that
 * the ops here come straight off `block.ops` rather than out of an agent
 * activity message.
 *
 * HOW A REJECTED OP LIST IS DETECTED. `processMessages` never throws and
 * returns nothing: the provider catches the processor's error, `console.warn`s
 * it, records the message in its error state (which `useA2UIError()` exposes
 * on the NEXT render — there is no synchronous read) and returns void. So the
 * only success signal is the store's `version` counter, which it bumps ONLY
 * after the op list applied. This effect therefore records the version it saw
 * when it called, and latches the hash on a LATER run — the one the version
 * bump itself schedules — and only if the version actually advanced. (This
 * reading is per-block only because the provider is: see `BlockCard`.)
 *
 * Latching a REJECTED op list would make the failure permanent: the next
 * ledger read carries the same list, which would be skipped as a duplicate
 * forever, leaving the card blank with no path back. Leaving it unlatched
 * means the next read REPLAYS the list, which is safe: `createSurface` is
 * stripped once the surface exists (it is the one op the processor rejects on
 * replay, "Surface … already exists"), and `updateComponents` is replace-style
 * — it overwrites each component id's properties, or recreates the component
 * when its type changed — so replaying it, including over the partial state a
 * mid-list rejection leaves behind, converges on the same surface.
 */
function SurfaceMessageProcessor({
  operations,
  surfaceId,
}: {
  operations: A2UIOp[];
  surfaceId: string;
}) {
  const { processMessages, getSurface } = useA2UIActions();
  const { version } = useA2UIState();
  const lastHashRef = useRef("");
  const pendingRef = useRef<{ hash: string; version: number } | null>(null);

  useEffect(() => {
    // Settle the previous call first: the version advanced ⇒ that op list
    // applied ⇒ latch it. It did not ⇒ the processor rejected the list, so
    // leave the hash unlatched and let a later ledger read try again. (The
    // failure itself is on screen: `SurfaceProcessingError` renders this
    // block's provider error state.)
    const pending = pendingRef.current;
    if (pending) {
      pendingRef.current = null;
      if (version > pending.version) lastHashRef.current = pending.hash;
    }

    if (!operations.length) return;
    const hash = JSON.stringify(operations);
    if (hash === lastHashRef.current) return;

    const isExisting = !!getSurface(surfaceId);
    const ops = isExisting
      ? operations.filter((op) => !("createSurface" in op))
      : operations;
    if (!ops.length) return;

    pendingRef.current = { hash, version };
    processMessages(ops as Array<Record<string, unknown>>);
  }, [operations, processMessages, getSurface, surfaceId, version]);

  return null;
}

export default DashboardGrid;
