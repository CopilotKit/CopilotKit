import { Catalog } from "@a2ui/web_core/v0_9";
import { BASIC_FUNCTIONS } from "@a2ui/web_core/v0_9/basic_catalog";
import { basicCatalog, createReactComponent } from "./a2ui-react";
import type { ReactComponentImplementation } from "./a2ui-react";
import type { ComponentApi, ResolveA2uiProps } from "@a2ui/web_core/v0_9";

// ─── Catalog Definitions (platform-agnostic) ─────────────────────────

/**
 * A props schema written with the Zod 3 API, typed by the Zod copy
 * `@a2ui/web_core` uses.
 *
 * `@a2ui/web_core` binds props by reading Zod 3 schema internals, and builds
 * its own schemas (`DynamicStringSchema` and the basic catalog) with Zod 3.
 * A Zod 4 or other Standard Schema cannot be bound, so it is rejected here.
 * Build props with the same Zod 3 release web_core installs. Next to Zod 4,
 * install it under an alias (`zod-v3@npm:zod@^3.25.76`) and import `z` from
 * `zod-v3` in catalog definitions only. Zod 4's `zod/v3` subpath is a
 * separate copy of the Zod 3 types, and mixing it with web_core's schemas
 * makes type-checking run out of memory.
 */
export type CatalogPropsSchema = ComponentApi["schema"];

/**
 * A single component definition — Zod props schema + optional description.
 * Platform-agnostic: no React or rendering details.
 */
export interface CatalogComponentDefinition<
  Props extends CatalogPropsSchema = CatalogPropsSchema,
> {
  /** Zod 3 API object schema for the component props. See {@link CatalogPropsSchema}. */
  props: Props;
  /** Description for the AI agent */
  description?: string;
}

/**
 * A record mapping component names to their definitions.
 * This is the platform-agnostic "contract" that agents use.
 */
export type CatalogDefinitions = Record<string, CatalogComponentDefinition>;

/**
 * Infer the props type for a specific component in the definitions.
 */
export type PropsOf<
  D extends CatalogDefinitions,
  K extends keyof D,
> = D[K]["props"]["_output"];

// ─── Catalog Renderers (platform-specific) ───────────────────────────

/**
 * Props passed to a renderer function.
 */
export interface RendererProps<T = Record<string, unknown>> {
  /**
   * Resolved prop values from the A2UI data model: bound values arrive as
   * their current value, Action props as functions that dispatch the action,
   * and each bindable prop also gets a `set<Prop>` setter that writes the
   * data model (two-way binding).
   */
  props: T;
  /**
   * Render a child component by ID.
   *
   * Without `basePath`, the child inherits this component's data-context
   * path. List templates need each item's own path: a `ChildList` bound to
   * `{ componentId, path }` resolves to `{ id, basePath }` items, so call
   * `children(item.id, item.basePath)`. Omitting it resolves every item's
   * relative bindings against the list's path instead of the item's.
   */
  children: (id: string, basePath?: string) => React.ReactNode;
  /** Dispatch an A2UI action from this component (e.g., on button click) */
  dispatch?: (action: any) => void;
}

/**
 * A renderer function for a component.
 */
export type ComponentRenderer<T = Record<string, unknown>> = React.FC<
  RendererProps<T>
>;

/**
 * A record mapping component names to React renderer functions.
 * Type-checked against the catalog definitions, with each renderer's props
 * typed as the binder resolves them (see {@link RendererProps.props}).
 */
export type CatalogRenderers<D extends CatalogDefinitions> = {
  [K in keyof D]: ComponentRenderer<ResolveA2uiProps<PropsOf<D, K>>>;
};

// ─── Create Catalog ──────────────────────────────────────────────────

/**
 * Create an A2UI catalog from definitions and renderers.
 *
 * Definitions are platform-agnostic (Zod 3 API schemas + descriptions; see
 * {@link CatalogPropsSchema}).
 * Renderers are platform-specific (React components).
 * TypeScript enforces that renderers match definitions exactly.
 *
 * @example
 * ```tsx
 * // schema.ts (platform-agnostic)
 * import { z } from "zod-v3"; // zod@^3.25.76, see CatalogPropsSchema
 *
 * export const demoCatalogDefinitions = {
 *   Card: {
 *     description: "A card container",
 *     props: z.object({ title: z.string(), child: z.string().optional() }),
 *   },
 * } satisfies CatalogDefinitions;
 *
 * // catalog.tsx (React renderers)
 * export const demoCatalog = createCatalog(demoCatalogDefinitions, {
 *   Card: ({ props, children }) => (
 *     <div>{props.title}{props.child && children(props.child)}</div>
 *   ),
 * });
 * ```
 */
export function createCatalog<D extends CatalogDefinitions>(
  definitions: D,
  renderers: CatalogRenderers<D>,
  options?: {
    /** Catalog ID. Defaults to a generated URI. */
    catalogId?: string;
    /** If true, merge the built-in basic catalog components (Text, Button, Row, etc.) into this catalog. Default: false */
    includeBasicCatalog?: boolean;
  },
): Catalog<ReactComponentImplementation> {
  const catalogId = options?.catalogId ?? "copilotkit://custom-catalog";
  const includeBasic = options?.includeBasicCatalog === true;

  const customComponents: ReactComponentImplementation[] = [];

  for (const [name, def] of Object.entries(definitions)) {
    const api: ComponentApi = {
      name,
      schema: def.props,
    };

    const renderer = (renderers as Record<string, ComponentRenderer<any>>)[
      name
    ];
    const wrapped = createReactComponent(
      api,
      ({ props, buildChild, context }) => {
        const Render = renderer;
        const dispatch = (action: any) => {
          void context.dispatchAction(action);
        };
        return (
          <Render props={props} children={buildChild} dispatch={dispatch} />
        );
      },
    );

    customComponents.push(wrapped);
  }

  const allComponents = includeBasic
    ? [...Array.from(basicCatalog.components.values()), ...customComponents]
    : customComponents;

  const functions = includeBasic
    ? Array.from(basicCatalog.functions.values())
    : [];

  return new Catalog<ReactComponentImplementation>(
    catalogId,
    allComponents,
    functions,
  );
}

// ─── Extract Schema (for runtime) ────────────────────────────────────

/**
 * Extract a JSON-serializable schema from catalog definitions.
 * Suitable for passing to the runtime's `a2ui.schema` config.
 */
export function extractSchema(definitions: CatalogDefinitions): Array<{
  name: string;
  description?: string;
  props?: Record<string, unknown>;
}> {
  return Object.entries(definitions).map(([name, def]) => ({
    name,
    description: def.description,
    props: zodSchemaToSimpleObject(def.props),
  }));
}

function zodSchemaToSimpleObject(
  schema: CatalogPropsSchema,
): Record<string, unknown> {
  const shape: object = "shape" in schema ? (schema.shape as object) : {};
  const properties: Record<string, { type: string; description?: string }> = {};
  // `Object.entries` of an `object` gives `any` values: Zod 3 schemas.
  for (const [key, zodValue] of Object.entries(shape)) {
    properties[key] = {
      type: zodValue._def?.typeName ?? "unknown",
      ...(zodValue.description ? { description: zodValue.description } : {}),
    };
  }
  return { type: "object", properties };
}
