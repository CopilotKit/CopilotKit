import { Suspense, memo, type CSSProperties, type ReactNode } from "react";
import { useA2UI } from "../hooks/useA2UI";
import { useThemeOptional } from "../theme/ThemeContext";
import { A2uiSurface } from "../a2ui-react";
import { cn } from "../lib/utils";

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
  /** @deprecated - No longer needed in v0.9, components come from catalog */
  registry?: any;
}

/**
 * The `--a2ui-*` entries of a theme as a style object, so a host restyles a
 * surface by passing CSS custom properties as the provider's `theme`
 * (`{ "--a2ui-color-accent": "#0f766e" }`). Catalog renderers read every
 * colour, radius, shadow and font through `var(--a2ui-…, fallback)`.
 */
export function themeToCssVariables(
  theme: Record<string, unknown> | undefined,
): CSSProperties | undefined {
  if (!theme) return undefined;
  let vars: Record<string, string> | undefined;
  for (const [key, value] of Object.entries(theme)) {
    if (!key.startsWith("--a2ui-")) continue;
    if (typeof value !== "string" && typeof value !== "number") continue;
    (vars ??= {})[key] = String(value);
  }
  return vars as CSSProperties | undefined;
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
  const themeVars = themeToCssVariables(useThemeOptional());

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
      style={themeVars}
    >
      <Suspense fallback={actualLoadingFallback}>
        <A2uiSurface surface={surface} />
      </Suspense>
    </div>
  );
});

export default A2UIRenderer;
