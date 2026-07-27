"use client";

import { useEffect, useRef } from "react";
import {
  A2UIProvider,
  A2UIRenderer,
  useA2UIActions,
} from "@copilotkit/a2ui-renderer";
import { OpenGenerativeUIActivityRenderer } from "@copilotkit/react-core/v2";
import useCreditCards from "@/app/actions";
import { catalog } from "@/a2ui/catalog";
import { ReportDataProvider } from "@/a2ui/report-data";
import type { A2UIOp } from "@/a2ui/build-report-ops";
import { useReportSurface } from "./use-report-surface";
import { useOguiSurface } from "./use-ogui-surface";
import { useCanvas } from "./canvas-context";

export function ReportCanvas() {
  const { activeSurfaceKind } = useCanvas();
  if (activeSurfaceKind === "ogui") return <OguiCanvas />;
  return <ReportSurfaceCanvas />;
}

/** OGUI surfaces render their sandboxed iframe full-region on the canvas. */
function OguiCanvas() {
  const { content } = useOguiSurface();
  if (!content) return null;
  return (
    <div className="h-full overflow-y-auto">
      <div className="p-6 md:p-8" data-testid="ogui-surface">
        {/* message/agent are required by the renderer's prop type but only
            `content` is read; pass null to satisfy the type. */}
        <OpenGenerativeUIActivityRenderer
          activityType="open-generative-ui"
          content={content}
          message={null}
          agent={null}
        />
      </div>
    </div>
  );
}

function ReportSurfaceCanvas() {
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
      console.warn("[report-canvas] processMessages threw:", err);
    }
  }, [operations, processMessages, getSurface, surfaceId]);

  return null;
}
