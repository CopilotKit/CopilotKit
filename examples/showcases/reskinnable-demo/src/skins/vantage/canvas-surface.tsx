"use client";

import { useEffect, useMemo, useRef } from "react";
import {
  A2UIProvider,
  A2UIRenderer,
  useA2UIActions,
} from "@copilotkit/a2ui-renderer";
import { useAgent } from "@copilotkit/react-core/v2";
import { catalog } from "./catalog";
import { BoardDataProvider } from "./board-data";
import {
  A2UI_OPERATIONS_KEY,
  extractBoardBinding,
  extractSurfaceId,
} from "./build-board-ops";
import type { A2UIOp } from "./build-board-ops";

/**
 * The Vantage board canvas — `skin.CanvasSurface`. The shell owns the canvas
 * region, OGUI rendering and surface-kind detection; this renders only this
 * skin's OWN a2ui surface, binding live board figures into the catalog
 * renderers via `BoardDataProvider`.
 */
type MaybeActivityMessage = {
  role?: string;
  activityType?: string;
  content?: Record<string, unknown>;
};

/** Stable empty result, so the "no board yet" render does not churn the memo. */
const NO_SURFACE: { operations: A2UIOp[]; surfaceId: string | null } = {
  operations: [],
  surfaceId: null,
};

function useBoardSurface(): { operations: A2UIOp[]; surfaceId: string | null } {
  const { agent } = useAgent();
  const messages = agent?.messages as MaybeActivityMessage[] | undefined;
  if (messages) {
    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i];
      if (
        message?.role === "activity" &&
        message?.activityType === "a2ui-surface"
      ) {
        const operations =
          (message.content?.[A2UI_OPERATIONS_KEY] as A2UIOp[]) ?? [];
        return {
          operations,
          surfaceId: operations.length ? extractSurfaceId(operations) : null,
        };
      }
    }
  }
  return NO_SURFACE;
}

/**
 * The surface is read HERE, above the provider, because the board's ops are also
 * where its lens and metric selection live — the provider has to be told both
 * before it fetches. Reading them below the provider (or not at all) is what let
 * a board headed "Q2 2026 · EMEA" render Q3 all-regions figures with no error.
 */
export function VantageCanvasSurface() {
  const { operations, surfaceId } = useBoardSurface();
  const binding = useMemo(() => extractBoardBinding(operations), [operations]);
  return (
    <BoardDataProvider lens={binding?.lens} metrics={binding?.metrics}>
      <A2UIProvider catalog={catalog}>
        <CanvasInner operations={operations} surfaceId={surfaceId} />
      </A2UIProvider>
    </BoardDataProvider>
  );
}

function CanvasInner({
  operations,
  surfaceId,
}: {
  operations: A2UIOp[];
  surfaceId: string | null;
}) {
  const hasContent = operations.length > 0 && !!surfaceId;
  return (
    <>
      {surfaceId ? (
        <SurfaceMessageProcessor
          operations={operations}
          surfaceId={surfaceId}
        />
      ) : null}
      {hasContent ? (
        <div className="h-full overflow-y-auto bg-canvas">
          <div className="a2ui-surface p-6 md:p-8" data-testid="a2ui-surface">
            <A2UIRenderer surfaceId={surfaceId} />
          </div>
        </div>
      ) : null}
    </>
  );
}

/**
 * Feeds operations into the A2UI provider. The activity content carries the
 * FULL operation list on each snapshot, so strip a duplicate createSurface once
 * the surface exists (the MessageProcessor throws on it) and skip re-processing
 * identical op lists.
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

    // The activity carries the FULL op list on every snapshot, so a second
    // createSurface for an existing surface would throw in the processor.
    const isExisting = !!getSurface(surfaceId);
    const ops = isExisting
      ? operations.filter((op) => !("createSurface" in op))
      : operations;
    if (!ops.length) return;
    try {
      processMessages(ops as Array<Record<string, unknown>>);
    } catch (err) {
      console.warn("[vantage-canvas] processMessages threw:", err);
    }
  }, [operations, processMessages, getSurface, surfaceId]);

  return null;
}

export default VantageCanvasSurface;
