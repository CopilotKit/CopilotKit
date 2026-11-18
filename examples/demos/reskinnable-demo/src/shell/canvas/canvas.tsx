"use client";

import type { ReactNode } from "react";
import { useCanvas } from "./canvas-context";
import { ReportCanvas } from "./report-canvas";

/**
 * Wraps the skin's page content. When a surface (a2ui report or OGUI) is active
 * in the agent stream, the shared canvas takes over the content region with a
 * "← Back" affordance to dismiss it; otherwise the normal page (`children`)
 * shows through.
 *
 * The shell owns the region + the surface-kind detection; <ReportCanvas/>
 * dispatches OGUI vs the active skin's own a2ui `CanvasSurface`.
 */
export function CanvasRegion({ children }: { children: ReactNode }) {
  const { activeSurfaceId, clear } = useCanvas();

  if (!activeSurfaceId) return <>{children}</>;

  return (
    <div className="flex h-full flex-1 flex-col">
      <div className="flex items-center gap-2 p-4">
        <button
          type="button"
          onClick={clear}
          className="inline-flex items-center gap-1 rounded-xl border border-hairline bg-surface px-3 py-1.5 text-sm text-ink shadow-soft"
        >
          ← Back
        </button>
      </div>
      <div className="min-h-0 flex-1">
        <ReportCanvas />
      </div>
    </div>
  );
}
