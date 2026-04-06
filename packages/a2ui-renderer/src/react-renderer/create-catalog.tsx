import { z, type ZodObject, type ZodRawShape } from "zod";
import { Catalog } from "@a2ui/web_core/v0_9";
import { BASIC_FUNCTIONS } from "@a2ui/web_core/v0_9/basic_catalog";
import { basicCatalog, createReactComponent } from "./a2ui-react";
import type { ReactComponentImplementation } from "./a2ui-react";
import type { ComponentApi } from "@a2ui/web_core/v0_9";

// ─── Catalog Definitions (platform-agnostic) ─────────────────────────

/**
 * A single component definition — Zod props schema + optional description.
 * Platform-agnostic: no React or rendering details.
 */
export interface CatalogComponentDefinition<
  T extends ZodRawShape = ZodRawShape,
> {
  /** Zod schema for component props */
  props: ZodObject<T>;
  /** Description for the AI agent */
  description?: string;
}

/**
 * A record mapping component names to their definitions.
 * This is the platform-agnostic "contract" that agents use.
 */
export type CatalogDefinitions = Record<
  string,
  CatalogComponentDefinition<any>
>;

/**
 * Infer the props type for a specific component in the definitions.
 */
export type PropsOf<D extends CatalogDefinitions, K extends keyof D> = z.infer<
  D[K]["props"]
>;

// ─── Catalog Renderers (platform-specific) ───────────────────────────

/**
 * Props passed to a renderer function.
 */
export interface RendererProps<T = Record<string, unknown>> {
  /** Resolved prop values from the A2UI data model */
  props: T;
  /** Render a child component by ID */
  children: (id: string) => React.ReactNode;
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
 * Type-checked against the catalog definitions.
 */
export type CatalogRenderers<D extends CatalogDefinitions> = {
  [K in keyof D]: ComponentRenderer<z.infer<D[K]["props"]>>;
};

// ─── Create Catalog ──────────────────────────────────────────────────

/**
 * Create an A2UI catalog from definitions and renderers.
 *
 * Definitions are platform-agnostic (Zod schemas + descriptions).
 * Renderers are platform-specific (React components).
 * TypeScript enforces that renderers match definitions exactly.
 *
 * @example
 * ```tsx
 * // schema.ts (platform-agnostic)
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
        const dispatch = (action: any) => context.dispatchAction(action);
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
  schema: ZodObject<any>,
): Record<string, unknown> {
  const shape = schema.shape;
  const properties: Record<string, { type: string; description?: string }> = {};
  for (const [key, value] of Object.entries(shape)) {
    const zodValue = value as any;
    properties[key] = {
      type: zodValue._def?.typeName ?? "unknown",
      ...(zodValue.description ? { description: zodValue.description } : {}),
    };
  }
  return { type: "object", properties };
}

// ─── Backward Compatibility ──────────────────────────────────────────

// Old API — definitions + renderers combined in one object
export interface A2UIComponentDefinition<T extends ZodRawShape = ZodRawShape> {
  props: ZodObject<T>;
  description?: string;
  render: React.FC<RendererProps<z.infer<ZodObject<T>>>>;
}

export type A2UIComponentMap = Record<string, A2UIComponentDefinition<any>>;

/**
 * @deprecated Use `createCatalog(definitions, renderers)` instead.
 */
export function createA2UICatalog(
  components: A2UIComponentMap,
  options?: {
    catalogId?: string;
    includeBasicCatalog?: boolean;
  },
): Catalog<ReactComponentImplementation> {
  const definitions: CatalogDefinitions = {};
  const renderers: Record<string, ComponentRenderer<any>> = {};

  for (const [name, def] of Object.entries(components)) {
    definitions[name] = { props: def.props, description: def.description };
    renderers[name] = def.render;
  }

  return createCatalog(definitions, renderers as any, options);
}

/**
 * @deprecated Use `extractSchema(definitions)` instead.
 */
export function extractA2UISchema(components: A2UIComponentMap): Array<{
  name: string;
  description?: string;
  props?: Record<string, unknown>;
}> {
  const definitions: CatalogDefinitions = {};
  for (const [name, def] of Object.entries(components)) {
    definitions[name] = { props: def.props, description: def.description };
  }
  return extractSchema(definitions);
}
