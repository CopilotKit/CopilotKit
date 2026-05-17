import type { KnownBlock } from "@slack/types";
import type { Catalog, ActionPayload, EncodedAction } from "./types.js";
import type { A2UIComponent, SurfaceState } from "./surface-state.js";
import { resolveProps } from "./binder.js";

/**
 * Render a resolved A2UI surface (post-operation-apply, post-data-model)
 * to a flat `KnownBlock[]` for Slack.
 *
 * Walks the component tree starting at id `"root"`. For each component:
 *
 *   1. Resolve all value-prop bindings via the binder.
 *   2. Look up the renderer in `catalog.renderers` by `component` name.
 *   3. Invoke it with `{ props, children, dispatch }` and collect blocks.
 *
 * `children(id, basePath?)` recursively renders a child by id and is
 * passed to the renderer. Structural template-children (the
 * `{ componentId, path }` shape) are expanded by the walker before
 * passing into the renderer — the renderer sees a plain id list.
 *
 * `dispatch.encodeAction(action)` packs an `ActionPayload` into a
 * `button.value`-safe string (≤ 2000 chars). When a click arrives,
 * the bridge decodes this and dispatches the action back to the
 * agent as a `forwardedProps.a2uiAction`.
 *
 * Unknown component names produce no blocks (logs a single warning).
 * That keeps Slack-side renderers a subset of a richer web catalog
 * without making the bot crash on a component it doesn't render.
 */
export function renderA2UISurface(
  state: SurfaceState,
  catalog: Catalog,
  encodeAction: (action: ActionPayload) => EncodedAction,
): KnownBlock[] {
  const warned = new Set<string>();
  const dispatch = { encodeAction };

  const renderOne = (id: string, basePath?: string): KnownBlock[] => {
    const comp = state.components.get(id);
    if (!comp) return [];

    // Render: the catalog renderer is the source of truth for layout.
    const renderer = catalog.renderers[comp.component];
    if (!renderer) {
      if (!warned.has(comp.component)) {
        warned.add(comp.component);
        console.warn(
          "[slack-bridge/a2ui] no renderer for component %s on catalog %s — skipping",
          comp.component,
          catalog.catalogId,
        );
      }
      return [];
    }

    // Pull props out of the component record (everything except id and
    // component name is a prop).
    const { id: _id, component: _name, ...rawProps } = comp;

    // Expand structural template-children BEFORE resolving value props —
    // the binder leaves these in place; we need to convert them to a
    // list of (childId, basePath) pairs the renderer can iterate.
    const expandedChildren = expandTemplateChildren(
      rawProps["children"],
      state.dataModel,
      basePath,
    );
    const propsForBinder: Record<string, unknown> =
      expandedChildren != null
        ? { ...rawProps, children: expandedChildren }
        : rawProps;

    const resolved = resolveProps(propsForBinder, state.dataModel, basePath);

    return renderer({
      props: resolved as Record<string, unknown>,
      // The renderer can render a child by id; basePath defaults to the
      // current basePath so simple parent→child trees just work.
      children: (childId: string, childBasePath?: string) =>
        renderOne(childId, childBasePath ?? basePath),
      dispatch,
    });
  };

  return renderOne("root");
}

/**
 * Expand a structural `children` prop into a flat list the renderer
 * can iterate.
 *
 *   - `{ componentId, path }` → array of `{ id: componentId, basePath: "<path>[i]" }`
 *   - `string[]` → unchanged (the renderer iterates ids directly)
 *   - `undefined` → return `null` (signal: no children prop)
 *   - anything else → return the input as-is (defensive)
 */
function expandTemplateChildren(
  raw: unknown,
  dataModel: Record<string, unknown>,
  basePath: string | undefined,
): unknown {
  if (raw == null) return null;
  if (Array.isArray(raw)) return raw;
  if (
    typeof raw === "object" &&
    "componentId" in (raw as Record<string, unknown>) &&
    "path" in (raw as Record<string, unknown>)
  ) {
    const { componentId, path } = raw as { componentId: string; path: string };
    // Read the array at `path` (absolute or relative).
    const cleaned = path.startsWith("/") ? path.slice(1) : path;
    const absolute = path.startsWith("/");
    const joined =
      absolute || !basePath || basePath.length === 0
        ? cleaned
        : `${basePath}.${cleaned}`;
    const arr = walkArray(dataModel as unknown, joined);
    if (!Array.isArray(arr)) return [];
    return arr.map((_item, i) => ({
      id: componentId,
      basePath: `${joined}[${i}]`,
    }));
  }
  return raw;
}

function walkArray(root: unknown, joinedPath: string): unknown {
  const segments = joinedPath
    .replace(/\[(\w+)\]/g, ".$1")
    .split(".")
    .filter(Boolean);
  let cursor: unknown = root;
  for (const seg of segments) {
    if (cursor == null) return undefined;
    if (Array.isArray(cursor)) {
      const idx = Number(seg);
      if (!Number.isFinite(idx)) return undefined;
      cursor = cursor[idx];
      continue;
    }
    if (typeof cursor === "object") {
      cursor = (cursor as Record<string, unknown>)[seg];
      continue;
    }
    return undefined;
  }
  return cursor;
}
