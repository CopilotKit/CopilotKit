"use client";

import { useLogistics } from "./actions";
import { BriefDataProvider } from "./brief-data";
import { useLatestSurfaceOperations } from "@/shell/canvas/canvas-context";
import { PageSurface } from "@/shell/generative-ui/page-surface";

/**
 * The Meridian decision-brief canvas — `skin.CanvasSurface`. The shell owns the
 * canvas region, OGUI rendering and surface-kind detection; this renders only
 * this skin's OWN brief surface, binding live ledger data into the catalog
 * components. The agent's brief ops come from the latest
 * `generative-ui-surface` activity (`useLatestSurfaceOperations`) and render
 * on the canvas with `<PageSurface>`.
 */
export function LogisticsCanvasSurface() {
  const { shipments, lanes } = useLogistics();
  return (
    <BriefDataProvider value={{ shipments, lanes }}>
      <CanvasInner />
    </BriefDataProvider>
  );
}

function CanvasInner() {
  const { operations, surfaceId } = useLatestSurfaceOperations();
  if (!operations.length || !surfaceId) return null;
  return (
    <div className="h-full overflow-y-auto">
      <div className="a2ui-surface p-6 md:p-8" data-testid="a2ui-surface">
        <PageSurface target="canvas:logistics" operations={operations} />
      </div>
    </div>
  );
}

export default LogisticsCanvasSurface;
