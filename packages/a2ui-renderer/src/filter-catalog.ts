import type { CatalogInterface, ComponentApi } from "@a2ui/web_core/v0_9";

/**
 * What web_core's `Catalog` memoizes from its entries on first use: the
 * validation schema, the catalog document and the component reference map.
 * A filtered copy must not inherit them from the unfiltered source.
 */
const DERIVED_CATALOG_CACHES = [
  "cachedValidationSchema",
  "cachedDocument",
  "_componentRefMap",
] as const;

/** The web_core `Catalog` method that rebuilds a catalog with other entries. */
interface RebuildableCatalog {
  withEntries(components: unknown[], functions: unknown[]): object;
}

function isRebuildable(catalog: object): catalog is RebuildableCatalog {
  return (
    typeof (catalog as Partial<RebuildableCatalog>).withEntries === "function"
  );
}

/**
 * Returns a copy of a catalog that keeps only the components whose `name`
 * passes `predicate`.
 *
 * Pure: the source catalog is not changed. The copy keeps the source's
 * class and every other field — `id`, `protocolVersion`, `functions`,
 * `invoker`, `themeSchema`, and fields a subclass adds, such as an Angular
 * catalog's `surfaceComponent`. A web_core `Catalog` is rebuilt with
 * `withEntries`, so what it derives from its entries (the native 1.0
 * document, its local `$defs`, the validation schema) describes only the
 * kept components. React, Vue and Angular use it to apply the Inspector's
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
  const rebuilt = isRebuildable(catalog)
    ? catalog.withEntries(
        [...components.values()],
        [...catalog.functions.values()],
      )
    : { components };
  const copy: C = Object.assign(
    Object.create(Object.getPrototypeOf(catalog)),
    catalog,
    rebuilt,
  );
  // The rebuilt catalog has computed none of these yet.
  for (const key of DERIVED_CATALOG_CACHES) {
    delete (copy as Record<string, unknown>)[key];
  }
  return copy;
}
