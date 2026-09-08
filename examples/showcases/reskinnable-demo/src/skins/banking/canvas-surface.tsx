"use client";

import { useEffect, useRef } from "react";
import {
  A2UIProvider,
  A2UIRenderer,
  useA2UIActions,
} from "@copilotkit/a2ui-renderer";
import { useAgent } from "@copilotkit/react-core/v2";
import useCreditCards from "@/skins/banking/actions";
import { catalog } from "@/skins/banking/catalog";
import { ReportDataProvider } from "@/skins/banking/report-data";
import {
  A2UI_OPERATIONS_KEY,
  extractSurfaceId,
} from "@/skins/banking/build-report-ops";
import type { A2UIOp } from "@/skins/banking/build-report-ops";

/**
 * The banking skin's a2ui report canvas — `skin.CanvasSurface`. The shell owns
 * the canvas region, OGUI rendering and surface-kind detection; this component
 * only renders banking's OWN a2ui report surface. It binds live banking data
 * (via useCreditCards → ReportDataProvider) into the catalog renderers and
 * processes the agent's report ops into the A2UI provider.
 *
 * Ported from the shell's former report-canvas REPORT path; `useReportSurface`
 * is inlined here (it read banking-specific ops keys, so it is not shell chrome).
 */

/** Minimal shape of an A2UI activity message in the agent's message list. */
type MaybeActivityMessage = {
  role?: string;
  activityType?: string;
  content?: Record<string, unknown>;
};

/**
 * The latest A2UI report surface in the agent's message stream. The A2UI
 * middleware turns the render_report tool result into an `a2ui-surface`
 * activity message carrying `a2ui_operations`; we read it straight from
 * `agent.messages`, the pattern the framework's own renderer uses.
 */
function useReportSurface(): {
  operations: A2UIOp[];
  surfaceId: string | null;
} {
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

export function BankingCanvasSurface() {
  const { transactions, policies } = useCreditCards();
  return (
    <ReportDataProvider value={{ transactions, policies }}>
      <A2UIProvider catalog={catalog}>
        <CanvasInner />
      </A2UIProvider>
    </ReportDataProvider>
  );
}

function CanvasInner() {
  const { operations, surfaceId } = useReportSurface();
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
 * createSurface once the surface exists (the MessageProcessor throws on it) and
 * skip re-processing identical op lists. Mirrors the framework's built-in
 * SurfaceMessageProcessor.
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
      console.warn("[banking-canvas] processMessages threw:", err);
    }
  }, [operations, processMessages, getSurface, surfaceId]);

  return null;
}

export default BankingCanvasSurface;
