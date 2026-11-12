"use client";

import { GenerativeUISurface } from "@copilotkit/react-core/generative-ui";
import { useLatestSurfaceOperations } from "@/shell/canvas/canvas-context";
import { usePageSurface } from "@/shell/generative-ui/page-surface";

/**
 * The Keel skin's a2ui report canvas — `skin.CanvasSurface`. It renders the
 * latest keel surface through `keelReportUI` (`./report-ui.tsx`), which the
 * skin's UI extends. That file explains the two surfaces it renders.
 */

export function KeelCanvasSurface() {
  return <CanvasInner />;
}

/** The page target the canvas's copy of the surface renders under. */
const CANVAS_TARGET = "canvas:keel";

function CanvasInner() {
  const { operations, surfaceId } = useLatestSurfaceOperations();
  const { rejected } = usePageSurface(CANVAS_TARGET, operations);
  if (!operations.length || !surfaceId) return null;
  // Rejected ops surface here (full-region), not just to the console — the
  // canvas owns the whole page, so a blank region with no explanation is the
  // worst outcome. The panel belongs to the surface it describes: it goes
  // with the surface, and a corrected op list re-renders the surface.
  if (rejected.length) return <CanvasError message={rejected[0]} />;
  return (
    <div className="h-full overflow-y-auto">
      <div className="a2ui-surface p-6 md:p-8" data-testid="a2ui-surface">
        <GenerativeUISurface id={CANVAS_TARGET} autoScroll={false} />
      </div>
    </div>
  );
}

/** Full-region, token-styled failure state for a report that could not render. */
function CanvasError({ message }: { message: string }) {
  return (
    <div className="h-full overflow-y-auto">
      <div className="p-6 md:p-8">
        <div
          className="rounded-lg border border-hairline bg-negative-soft p-6 shadow-soft"
          data-testid="a2ui-surface-error"
        >
          <h2 className="text-lg font-semibold text-negative">
            Report failed to render
          </h2>
          <p className="mt-2 text-sm text-ink-muted">
            The operations report could not be processed. It will render
            automatically when the agent sends a corrected report.
          </p>
          <p className="mt-4 rounded-md border border-hairline bg-surface p-3 font-mono text-xs text-ink-muted">
            {message}
          </p>
        </div>
      </div>
    </div>
  );
}

export default KeelCanvasSurface;
