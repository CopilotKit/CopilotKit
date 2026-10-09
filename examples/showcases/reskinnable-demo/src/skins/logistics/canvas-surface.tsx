"use client";

import { useEffect, useRef } from "react";
import {
  A2UIProvider,
  A2UIRenderer,
  useA2UIActions,
} from "@copilotkit/a2ui-renderer";
import { useAgent } from "@copilotkit/react-core/v2";
import { useLogistics } from "./actions";
import { catalog } from "./catalog";
import { BriefDataProvider } from "./brief-data";
import {
  A2UI_OPERATIONS_KEY,
  extractSurfaceId,
  type A2UIOp,
} from "./build-brief-ops";

/**
 * The Meridian decision-brief canvas — `skin.CanvasSurface`. The shell owns the
 * canvas region, OGUI rendering and surface-kind detection; this renders only
 * this skin's OWN a2ui surface, binding live ledger data into the catalog
 * renderers.
 */
type MaybeActivityMessage = {
  role?: string;
  activityType?: string;
  content?: Record<string, unknown>;
};

function useBriefSurface(): { operations: A2UIOp[]; surfaceId: string | null } {
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
  return { operations: [], surfaceId: null };
}

export function LogisticsCanvasSurface() {
  const { shipments, lanes } = useLogistics();
  return (
    <BriefDataProvider value={{ shipments, lanes }}>
      <A2UIProvider catalog={catalog}>
        <CanvasInner />
      </A2UIProvider>
    </BriefDataProvider>
  );
}

function CanvasInner() {
  const { operations, surfaceId } = useBriefSurface();
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
        <div className="h-full overflow-y-auto">
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

    const isExisting = !!getSurface(surfaceId);
    const ops = isExisting
      ? operations.filter((op) => !("createSurface" in op))
      : operations;
    if (!ops.length) return;
    try {
      processMessages(ops as Array<Record<string, unknown>>);
    } catch (err) {
      console.warn("[logistics-canvas] processMessages threw:", err);
    }
  }, [operations, processMessages, getSurface, surfaceId]);

  return null;
}

export default LogisticsCanvasSurface;
