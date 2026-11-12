"use client";

import useCreditCards from "@/skins/banking/actions";
import { ReportDataProvider } from "@/skins/banking/report-data";
import { useLatestSurfaceOperations } from "@/shell/canvas/canvas-context";
import { PageSurface } from "@/shell/generative-ui/page-surface";

/**
 * The banking skin's report canvas — `skin.CanvasSurface`. The shell owns the
 * canvas region, OGUI rendering and surface-kind detection; this component
 * only renders banking's OWN report surface. It binds live banking data (via
 * useCreditCards → ReportDataProvider) into the catalog components and renders
 * the agent's report ops with the skin's generative UI (`skin.catalog`, which
 * the shell hands `CopilotKitProvider` as `generativeUI={{ ui }}`).
 *
 * The render_report tool result reaches the browser as a
 * `generative-ui-surface` activity (the runtime converts its A2UI v0.9 ops to
 * 1.0); `useLatestSurfaceOperations` reads the latest one off `agent.messages`.
 */
export function BankingCanvasSurface() {
  const { transactions, policies } = useCreditCards();
  return (
    <ReportDataProvider value={{ transactions, policies }}>
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
        <PageSurface target="canvas:banking" operations={operations} />
      </div>
    </div>
  );
}

export default BankingCanvasSurface;
