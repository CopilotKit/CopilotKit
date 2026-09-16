"use client";

import { useEffect, useRef } from "react";
import {
  A2UIProvider,
  A2UIRenderer,
  useA2UIActions,
} from "@copilotkit/a2ui-renderer";
import { useAgent } from "@copilotkit/react-core/v2";
import { catalog } from "./catalog";
import { usePeopleLedger } from "./data/ledger-context";
import { ReportDataProvider } from "./report-data";
import { A2UI_OPERATIONS_KEY, extractSurfaceId } from "./build-brief-ops";
import type { A2UIOp } from "./build-brief-ops";

/**
 * Rowan's People Review brief canvas — `skin.CanvasSurface`. The shell owns the
 * canvas region, OGUI rendering and surface-kind detection; this component
 * renders only this skin's OWN a2ui surface. It binds live people data (via
 * usePeopleLedger → ReportDataProvider) into the catalog renderers and feeds the
 * agent's brief ops into the A2UI provider.
 */

/** Minimal shape of an A2UI activity message in the agent's message list. */
type MaybeActivityMessage = {
  role?: string;
  activityType?: string;
  content?: Record<string, unknown>;
};

/**
 * The latest A2UI brief surface in the agent's message stream. The A2UI
 * middleware turns the render tool result into an `a2ui-surface` activity
 * message carrying `a2ui_operations`; we read it straight from `agent.messages`,
 * the pattern the framework's own renderer uses.
 */
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

export function PeopleCanvasSurface() {
  // The ledger context is mounted ABOVE this in the skin runtime subtree, so
  // the canvas reads the SAME snapshot as the pages — the brief and the roster
  // are never one fetch apart.
  const { data } = usePeopleLedger();
  return (
    <ReportDataProvider
      value={{
        employees: data.employees,
        bands: data.bands,
        requests: data.requests,
      }}
    >
      <A2UIProvider catalog={catalog}>
        <CanvasInner />
      </A2UIProvider>
    </ReportDataProvider>
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
 * Feeds the surface's operations into the A2UI provider. The activity content
 * carries the FULL operation list on each snapshot, so we strip a duplicate
 * createSurface once the surface exists (the MessageProcessor throws if asked to
 * create a surface that already exists) and skip re-processing identical op
 * lists via a hash. Mirrors the framework's built-in SurfaceMessageProcessor.
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
      console.warn("[people-canvas] processMessages threw:", err);
    }
  }, [operations, processMessages, getSurface, surfaceId]);

  return null;
}

export default PeopleCanvasSurface;
