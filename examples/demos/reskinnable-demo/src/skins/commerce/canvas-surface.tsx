"use client";

import { useCommerceLedger } from "./data/ledger-context";
import { ReportDataProvider } from "./report-data";
import { useLatestSurfaceOperations } from "@/shell/canvas/canvas-context";
import { PageSurface } from "@/shell/generative-ui/page-surface";

/**
 * Bellwether's Trading Review brief canvas — `skin.CanvasSurface`. The shell
 * owns the canvas region, OGUI rendering and surface-kind detection; this
 * component renders only this skin's OWN brief surface. It binds live commerce
 * data (via useCommerceLedger → ReportDataProvider) into the catalog renderers
 * and renders the agent's brief ops (the latest
 * `generative-ui-surface` activity) with `<PageSurface>`.
 */

export function CommerceCanvasSurface() {
  // The ledger context is mounted ABOVE this in the skin runtime subtree, so the
  // canvas reads the SAME snapshot as the pages — the brief and the order book
  // are never one fetch apart.
  const { data } = useCommerceLedger();
  return (
    <ReportDataProvider
      value={{
        products: data.products,
        floors: data.floors,
        orders: data.orders,
        promotions: data.promotions,
      }}
    >
      <CanvasInner />
    </ReportDataProvider>
  );
}

function CanvasInner() {
  const { operations, surfaceId } = useLatestSurfaceOperations();
  if (!operations.length || !surfaceId) return null;
  return (
    <div className="h-full overflow-y-auto">
      <div className="a2ui-surface p-6 md:p-8" data-testid="a2ui-surface">
        <PageSurface target="canvas:commerce" operations={operations} />
      </div>
    </div>
  );
}

export default CommerceCanvasSurface;
