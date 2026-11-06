import { Suspense, memo } from "react";
import type { ReactNode } from "react";
import { useA2UI } from "../hooks/useA2UI";
import { A2uiSurface } from "../a2ui-react";
import { cn } from "../lib/utils";
import { useA2UISurfaceError } from "./A2UIProvider";
import { ROOT_COMPONENT_ID } from "../../a2ui-types.js";

/** Default loading fallback - memoized to prevent recreation */
const DefaultLoadingFallback = memo(function DefaultLoadingFallback() {
  return (
    <div className="a2ui-loading" style={{ padding: "16px", opacity: 0.5 }}>
      Loading...
    </div>
  );
});

export interface A2UIRendererProps {
  /** The surface ID to render */
  surfaceId: string;
  /** Additional CSS classes for the surface container */
  className?: string;
  /** Fallback content when surface is not yet available */
  fallback?: ReactNode;
  /** Loading fallback for lazy-loaded components */
  loadingFallback?: ReactNode;
}

/**
 * A2UIRenderer - renders an A2UI surface using the v0.9 renderer.
 *
 * Uses A2uiSurface from a2ui-react which handles all component
 * rendering internally via the catalog system.
 */
export const A2UIRenderer = memo(function A2UIRenderer({
  surfaceId,
  className,
  fallback = null,
  loadingFallback,
}: A2UIRendererProps) {
  const { getSurface, version } = useA2UI();
  const surfaceError = useA2UISurfaceError(surfaceId);

  // Get v0.9 SurfaceModel - this will re-render when version changes
  const surface = getSurface(surfaceId);

  // No surface yet
  if (!surface) {
    return <>{fallback}</>;
  }

  // Use provided fallback or default memoized component
  const actualLoadingFallback = loadingFallback ?? <DefaultLoadingFallback />;

  return (
    <div
      className={cn("a2ui-surface", className)}
      data-surface-id={surfaceId}
      data-version={version}
    >
      {surfaceError && (
        <div role="alert">
          Unable to display this surface: {surfaceError}. Ask the assistant to
          correct these components and try again.
        </div>
      )}
      {/* A rejected first update leaves no root; skip its loading placeholder. */}
      {(!surfaceError || surface.componentsModel.get(ROOT_COMPONENT_ID)) && (
        <Suspense fallback={actualLoadingFallback}>
          <A2uiSurface surface={surface} />
        </Suspense>
      )}
    </div>
  );
});

export default A2UIRenderer;
