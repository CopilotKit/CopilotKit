import { Suspense, useMemo, memo } from 'react';
import type { Types } from '@a2ui/lit/0.8';
import { ComponentRegistry } from '../registry/ComponentRegistry';

/** Memoized loading fallback to avoid recreating on each render */
const LoadingFallback = memo(function LoadingFallback() {
  return (
    <div className="a2ui-loading" style={{ padding: '8px', opacity: 0.5 }}>
      Loading...
    </div>
  );
});

interface ComponentNodeProps {
  /** The component node to render (can be null/undefined for safety) */
  node: Types.AnyComponentNode | null | undefined;
  /** The surface ID this component belongs to */
  surfaceId: string;
  /** Optional custom registry. Falls back to singleton. */
  registry?: ComponentRegistry;
}

/**
 * ComponentNode - dynamically renders an A2UI component based on its type.
 *
 * Looks up the component in the registry and renders it with the appropriate props.
 * Supports lazy-loaded components via React.Suspense.
 *
 * No wrapper div is rendered - the component's root div (e.g., .a2ui-image) is the
 * direct flex child, exactly matching Lit's structure where the :host element IS
 * the flex item. Each component handles --weight CSS variable on its root div.
 *
 * Memoized to prevent unnecessary re-renders when parent updates but node hasn't changed.
 */
export const ComponentNode = memo(function ComponentNode({
  node,
  surfaceId,
  registry,
}: ComponentNodeProps) {
  const actualRegistry = registry ?? ComponentRegistry.getInstance();

  // useMemo must be called unconditionally (Rules of Hooks)
  // We handle invalid nodes by returning null component type
  const nodeType = node && typeof node === 'object' && 'type' in node ? node.type : null;

  const Component = useMemo(
    () => (nodeType ? actualRegistry.get(nodeType) : null),
    [actualRegistry, nodeType]
  );

  // Handle null/undefined/invalid nodes gracefully
  if (!nodeType) {
    if (node) {
      console.warn('[A2UI] Invalid component node (not resolved?):', node);
    }
    return null;
  }

  if (!Component) {
    console.warn(`[A2UI] Unknown component type: ${nodeType}`);
    return null;
  }

  // No wrapper div - component's root div is the :host equivalent
  // Suspense doesn't add DOM elements, preserving the correct hierarchy
  // Type assertion is safe: we've already validated node is valid (nodeType check above)
  return (
    <Suspense fallback={<LoadingFallback />}>
      <Component node={node as Types.AnyComponentNode} surfaceId={surfaceId} />
    </Suspense>
  );
});

export default ComponentNode;
