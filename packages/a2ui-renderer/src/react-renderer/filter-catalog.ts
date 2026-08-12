import { Catalog } from "@a2ui/web_core/v0_9";
import type { ComponentApi } from "@a2ui/web_core/v0_9";

/**
 * Rebuild a Catalog keeping only components whose `name` passes `predicate`.
 *
 * Pure: does not mutate the source catalog. The returned catalog preserves the
 * original `id`, all `functions`, and the `themeSchema`; only the component set
 * is narrowed. Used by react-core to enforce per-component enable/disable on
 * BOTH the advertisement path (context) and the render path.
 *
 * @typeParam T - The component implementation type carried by the catalog.
 * @param catalog - The source catalog.
 * @param predicate - Returns true to KEEP a component with the given name.
 */
export function filterCatalog<T extends ComponentApi>(
  catalog: Catalog<T>,
  predicate: (name: string) => boolean,
): Catalog<T> {
  const keptComponents: T[] = [];
  for (const [name, component] of catalog.components) {
    if (predicate(name)) {
      keptComponents.push(component);
    }
  }
  const functions = Array.from(catalog.functions.values());
  return new Catalog<T>(
    catalog.id,
    keptComponents,
    functions,
    catalog.themeSchema,
  );
}
