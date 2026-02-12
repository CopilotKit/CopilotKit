import { Suspense, useMemo, memo, type ReactNode } from 'react';
import { useA2UI } from '../hooks/useA2UI';
import { ComponentNode } from './ComponentNode';
import { type ComponentRegistry } from '../registry/ComponentRegistry';
import { cn } from '../lib/utils';

/** Default loading fallback - memoized to prevent recreation */
const DefaultLoadingFallback = memo(function DefaultLoadingFallback() {
  return (
    <div className="a2ui-loading" style={{ padding: '16px', opacity: 0.5 }}>
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
  /** Optional custom component registry */
  registry?: ComponentRegistry;
}

/**
 * A2UIRenderer - renders an A2UI surface.
 *
 * This is the main entry point for rendering A2UI content in your React app.
 * It reads the surface state from the A2UI store and renders the component tree.
 *
 * Memoized to prevent unnecessary re-renders when props haven't changed.
 *
 * @example
 * ```tsx
 * function App() {
 *   return (
 *     <A2UIProvider onAction={handleAction}>
 *       <A2UIRenderer surfaceId="main" />
 *     </A2UIProvider>
 *   );
 * }
 * ```
 */
export const A2UIRenderer = memo(function A2UIRenderer({
  surfaceId,
  className,
  fallback = null,
  loadingFallback,
  registry,
}: A2UIRendererProps) {
  const { getSurface, version } = useA2UI();

  // Get surface - this will re-render when version changes
  const surface = getSurface(surfaceId);

  // Memoize surface styles to prevent object recreation
  // Matches Lit renderer's transformation logic in surface.ts
  const surfaceStyles = useMemo<React.CSSProperties>(() => {
    if (!surface?.styles) return {};

    const styles: React.CSSProperties & Record<string, string> = {};

    for (const [key, value] of Object.entries(surface.styles)) {
      switch (key) {
        // Generate a color palette from the primary color.
        // Values range from 0-100 where 0=black, 100=white, 50=primary color.
        // Uses color-mix to create intermediate values.
        case 'primaryColor': {
          styles['--p-100'] = '#ffffff';
          styles['--p-99'] = `color-mix(in srgb, ${value} 2%, white 98%)`;
          styles['--p-98'] = `color-mix(in srgb, ${value} 4%, white 96%)`;
          styles['--p-95'] = `color-mix(in srgb, ${value} 10%, white 90%)`;
          styles['--p-90'] = `color-mix(in srgb, ${value} 20%, white 80%)`;
          styles['--p-80'] = `color-mix(in srgb, ${value} 40%, white 60%)`;
          styles['--p-70'] = `color-mix(in srgb, ${value} 60%, white 40%)`;
          styles['--p-60'] = `color-mix(in srgb, ${value} 80%, white 20%)`;
          styles['--p-50'] = String(value);
          styles['--p-40'] = `color-mix(in srgb, ${value} 80%, black 20%)`;
          styles['--p-35'] = `color-mix(in srgb, ${value} 70%, black 30%)`;
          styles['--p-30'] = `color-mix(in srgb, ${value} 60%, black 40%)`;
          styles['--p-25'] = `color-mix(in srgb, ${value} 50%, black 50%)`;
          styles['--p-20'] = `color-mix(in srgb, ${value} 40%, black 60%)`;
          styles['--p-15'] = `color-mix(in srgb, ${value} 30%, black 70%)`;
          styles['--p-10'] = `color-mix(in srgb, ${value} 20%, black 80%)`;
          styles['--p-5'] = `color-mix(in srgb, ${value} 10%, black 90%)`;
          styles['--p-0'] = '#000000';
          break;
        }

        case 'font': {
          styles['--font-family'] = String(value);
          styles['--font-family-flex'] = String(value);
          break;
        }
      }
    }
    return styles;
  }, [surface?.styles]);

  // No surface yet
  if (!surface || !surface.componentTree) {
    return <>{fallback}</>;
  }

  // Use provided fallback or default memoized component
  const actualLoadingFallback = loadingFallback ?? <DefaultLoadingFallback />;

  return (
    <div
      className={cn('a2ui-surface', className)}
      style={surfaceStyles}
      data-surface-id={surfaceId}
      data-version={version}
    >
      <Suspense fallback={actualLoadingFallback}>
        <ComponentNode
          node={surface.componentTree}
          surfaceId={surfaceId}
          registry={registry}
        />
      </Suspense>
    </div>
  );
});

export default A2UIRenderer;
