"use client";

import { usePeopleLedger } from "./data/ledger-context";
import { ReportDataProvider } from "./report-data";
import { useLatestSurfaceOperations } from "@/shell/canvas/canvas-context";
import { PageSurface } from "@/shell/generative-ui/page-surface";

/**
 * Rowan's People Review brief canvas — `skin.CanvasSurface`. The shell owns the
 * canvas region, OGUI rendering and surface-kind detection; this component
 * renders only this skin's OWN brief surface. It binds live people data (via
 * usePeopleLedger → ReportDataProvider) into the catalog renderers and renders the
 * agent's brief ops (the latest `generative-ui-surface` activity) with
 * `<PageSurface>`.
 */

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
        <PageSurface target="canvas:people" operations={operations} />
      </div>
    </div>
  );
}

export default PeopleCanvasSurface;
