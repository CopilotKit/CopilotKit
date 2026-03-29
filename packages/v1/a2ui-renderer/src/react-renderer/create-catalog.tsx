import { z, type ZodObject, type ZodRawShape } from "zod";
import { Catalog } from "@a2ui/web_core/v0_9";
import { BASIC_FUNCTIONS } from "@a2ui/web_core/v0_9/basic_catalog";
import { basicCatalog, createReactComponent } from "@a2ui/react/v0_9";
import type { ReactComponentImplementation } from "@a2ui/react/v0_9";
import type { ComponentApi } from "@a2ui/web_core/v0_9";

/**
 * Props passed to a user-defined A2UI component.
 */
export interface A2UIComponentRenderProps<T = Record<string, unknown>> {
  /** Resolved prop values */
  props: T;
  /** Render a child component by ID */
  children: (id: string) => React.ReactNode;
}

/**
 * Component definition for the simplified catalog API.
 */
export interface A2UIComponentDefinition<T extends ZodRawShape = ZodRawShape> {
  /** Zod schema for component props */
  props: ZodObject<T>;
  /** Optional description for the AI agent */
  description?: string;
  /** React render function */
  render: React.FC<A2UIComponentRenderProps<z.infer<ZodObject<T>>>>;
}

/**
 * A record mapping component names to their definitions.
 */
export type A2UIComponentMap = Record<string, A2UIComponentDefinition<any>>;

/**
 * Creates an A2UI catalog from a simple component map.
 *
 * This is the recommended way to define custom A2UI components.
 * The catalog extends the basic catalog (Text, Button, Card, etc.)
 * with your custom components.
 *
 * @example
 * ```tsx
 * const catalog = createA2UICatalog({
 *   TodoCard: {
 *     props: z.object({
 *       title: z.string(),
 *       completed: z.boolean(),
 *     }),
 *     render: ({ props, children }) => (
 *       <div className={props.completed ? 'done' : ''}>
 *         {props.title}
 *       </div>
 *     ),
 *   },
 * });
 * ```
 */
export function createA2UICatalog(
  components: A2UIComponentMap,
  options?: {
    /** Catalog ID. Defaults to a generated URI. */
    catalogId?: string;
    /** If false, only include the custom components (no basic catalog). Default: true */
    includeBasicCatalog?: boolean;
  },
): Catalog<ReactComponentImplementation> {
  const catalogId =
    options?.catalogId ?? `copilotkit://custom-catalog/${Date.now()}`;
  const includeBasic = options?.includeBasicCatalog !== false;

  const customComponents: ReactComponentImplementation[] = [];

  for (const [name, def] of Object.entries(components)) {
    // Create a ComponentApi from the user's Zod schema
    const api: ComponentApi = {
      name,
      schema: def.props,
    };

    // Wrap the user's render function to match the createReactComponent signature
    const wrapped = createReactComponent(api, ({ props, buildChild }) => {
      const Render = def.render;
      return <Render props={props} children={buildChild} />;
    });

    customComponents.push(wrapped);
  }

  // Combine with basic catalog components
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

/**
 * Extracts component schema definitions from a component map,
 * suitable for passing to the runtime's `a2ui.schema` config.
 *
 * Note: This converts Zod schemas to JSON Schema using zod's built-in
 * .describe() metadata. For full JSON Schema output, define schemas
 * as plain JSON objects instead.
 *
 * @example
 * ```ts
 * const schema = extractA2UISchema(myComponents);
 * // Pass to CopilotRuntime: a2ui: { schema }
 * ```
 */
export function extractA2UISchema(
  components: A2UIComponentMap,
): Array<{ name: string; description?: string; props?: Record<string, unknown> }> {
  return Object.entries(components).map(([name, def]) => ({
    name,
    description: def.description,
    props: zodSchemaToSimpleObject(def.props),
  }));
}

/**
 * Lightweight conversion of a Zod object schema to a simple props descriptor.
 * Does not depend on zod-to-json-schema (which uses node:module).
 */
function zodSchemaToSimpleObject(schema: ZodObject<any>): Record<string, unknown> {
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
