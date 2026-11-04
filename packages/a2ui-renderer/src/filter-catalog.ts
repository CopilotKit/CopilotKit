import type { CatalogInterface, ComponentApi } from "@a2ui/web_core/v0_9";

/**
 * Returns a copy of a catalog that keeps only the components whose `name`
 * passes `predicate`.
 *
 * Pure: the source catalog is not changed. The copy keeps the source's
 * class and every other field — `id`, `functions`, `invoker`, `themeSchema`,
 * and fields a subclass adds, such as an Angular catalog's
 * `surfaceComponent`. React, Vue and Angular use it to apply the Inspector's
 * per-component enable/disable to both what the model is told and what can
 * render.
 *
 * @param catalog - The source catalog.
 * @param predicate - Returns true to KEEP a component with the given name.
 */
export function filterCatalog<C extends CatalogInterface<ComponentApi>>(
  catalog: C,
  predicate: (name: string) => boolean,
) {
  const components = new Map(
    [...catalog.components].filter(([name]) => predicate(name)),
  );
  const copy: C = Object.assign(
    Object.create(Object.getPrototypeOf(catalog)),
    catalog,
    { components },
  );
  return copy;
}
