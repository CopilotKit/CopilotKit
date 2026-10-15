import React, { useLayoutEffect } from "react";
import type { ReactNode } from "react";
import { useManagerVersion } from "./hooks";
import { useRequiredGenerativeUIRuntime } from "./runtime-context";
import { SurfaceView } from "./SurfaceView";

export interface GenerativeUISurfaceProps {
  /** Target id the agent renders into. */
  id: string;
  /**
   * Tells the model where this surface is and what to show in it, for
   * example "Next to the product list. Use it for product recommendations."
   */
  description?: string;
  /** Shown until a surface targets this id. */
  fallback?: ReactNode;
  className?: string;
}

/** Experimental. A named place on the page where the agent can render UI. */
export function GenerativeUISurface({
  id,
  description,
  fallback = null,
  className,
}: GenerativeUISurfaceProps) {
  const runtime = useRequiredGenerativeUIRuntime();
  useManagerVersion(runtime);
  useLayoutEffect(
    () => runtime.manager.registerTarget(id, description),
    [runtime, id, description],
  );
  const surface = runtime.manager.getSurfaceForTarget(id);
  if (!surface) return <>{fallback}</>;
  return (
    <div data-generative-ui-surface={id} className={className}>
      <SurfaceView surface={surface} />
    </div>
  );
}
