import type { z } from "zod";
import type { ZodObject, ZodRawShape, ZodTypeAny } from "zod";
import { Catalog } from "@a2ui/web_core/v0_9";
import type { ComponentApi } from "@a2ui/web_core/v0_9";
import { zodToJsonSchema } from "zod-to-json-schema";
import { basicCatalog } from "./catalog/basic";
import { createLitComponent } from "./adapter";
import type {
  CatalogComponentDefinition,
  CatalogDefinitions,
  CatalogRenderers,
  ComponentRenderer,
  LitComponentImplementation,
  RendererProps,
} from "./types";

const BASIC_CATALOG_ID =
  "https://a2ui.org/specification/v0_9/basic_catalog.json";

type CatalogContextComponent = {
  schema: unknown;
};

type CatalogContextValue = {
  id: string;
  components: ReadonlyMap<string, CatalogContextComponent>;
};

/**
 * Context description used to identify the A2UI component schema in RunAgentInput.context.
 * Must match the constant in @ag-ui/a2ui-middleware so the middleware can overwrite
 * a frontend-provided schema with a server-side one.
 */
export const A2UI_SCHEMA_CONTEXT_DESCRIPTION =
  "A2UI Component Schema — available components for generating UI surfaces. Use these component names and properties when creating A2UI operations.";

export type {
  CatalogComponentDefinition,
  CatalogDefinitions,
  CatalogRenderers,
  ComponentRenderer,
  RendererProps,
} from "./types";

export function createCatalog<D extends CatalogDefinitions>(
  definitions: D,
  renderers: CatalogRenderers<D>,
  options?: {
    catalogId?: string;
    includeBasicCatalog?: boolean;
  },
): Catalog<LitComponentImplementation> {
  const catalogId = options?.catalogId ?? "copilotkit://custom-catalog";
  const customComponents: LitComponentImplementation[] = [];

  for (const [name, def] of Object.entries(definitions)) {
    const api: ComponentApi = {
      name,
      schema: def.props,
    };
    const renderer = (renderers as Record<string, ComponentRenderer<any>>)[
      name
    ];
    if (renderer === undefined) {
      throw new Error(`Missing renderer for component "${name}"`);
    }
    customComponents.push(
      createLitComponent(api, ({ props, buildChild, context }) =>
        renderer({
          props,
          children: buildChild,
          dispatch: (action: unknown) => context.dispatchAction(action),
        }),
      ),
    );
  }

  const components =
    options?.includeBasicCatalog === true
      ? [...Array.from(basicCatalog.components.values()), ...customComponents]
      : customComponents;
  const functions =
    options?.includeBasicCatalog === true
      ? Array.from(basicCatalog.functions.values())
      : [];

  return new Catalog<LitComponentImplementation>(
    catalogId,
    components,
    functions,
  );
}

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

export interface A2UIComponentDefinition<T extends ZodRawShape = ZodRawShape> {
  props: ZodObject<T>;
  description?: string;
  render: (props: RendererProps<z.infer<ZodObject<T>>>) => unknown;
}

export type A2UIComponentMap = Record<string, A2UIComponentDefinition<any>>;

export function createA2UICatalog(
  components: A2UIComponentMap,
  options?: {
    catalogId?: string;
    includeBasicCatalog?: boolean;
  },
): Catalog<LitComponentImplementation> {
  const definitions: CatalogDefinitions = {};
  const renderers: Record<string, ComponentRenderer<any>> = {};

  for (const [name, def] of Object.entries(components)) {
    definitions[name] = { props: def.props, description: def.description };
    renderers[name] = def.render as ComponentRenderer<any>;
  }

  return createCatalog(definitions, renderers as any, options);
}

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

function isCatalogContextValue(value: unknown): value is CatalogContextValue {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    typeof value.id === "string" &&
    "components" in value &&
    value.components instanceof Map
  );
}

function resolveCatalog(catalog?: unknown): CatalogContextValue {
  return isCatalogContextValue(catalog) ? catalog : basicCatalog;
}

function toJsonSchema(
  schema: unknown,
  options?: Parameters<typeof zodToJsonSchema>[1],
): ReturnType<typeof zodToJsonSchema> {
  return zodToJsonSchema(schema as ZodTypeAny, options);
}

function extendsBasicCatalog(catalog: CatalogContextValue): boolean {
  for (const name of basicCatalog.components.keys()) {
    if (!catalog.components.has(name)) {
      return false;
    }
  }
  return true;
}

function getCustomComponentNames(catalog: CatalogContextValue): string[] {
  const custom: string[] = [];
  for (const name of catalog.components.keys()) {
    if (!basicCatalog.components.has(name)) {
      custom.push(name);
    }
  }
  return custom;
}

export function buildCatalogContextValue(catalog?: unknown): string {
  const resolved = resolveCatalog(catalog);
  const lines: string[] = ["Available A2UI catalog:"];

  if (resolved.id === BASIC_CATALOG_ID) {
    lines.push(`- ${resolved.id} (basic catalog)`);
    return lines.join("\n");
  }

  const isSuperset = extendsBasicCatalog(resolved);
  const customNames = getCustomComponentNames(resolved);

  lines.push(`- ${resolved.id}`);
  if (isSuperset) {
    lines.push(
      "  Extends the basic catalog with all standard components plus:",
    );
  } else {
    lines.push("  Custom catalog (does NOT include all basic components).");
    lines.push("  Custom components:");
  }

  for (const name of customNames) {
    const component = resolved.components.get(name);
    if (!component) continue;
    const jsonSchema = toJsonSchema(component.schema);
    lines.push(`  - ${name}:`);
    lines.push(
      `    ${JSON.stringify(jsonSchema, null, 2).split("\n").join("\n    ")}`,
    );
  }

  return lines.join("\n");
}

export interface InlineCatalogSchema {
  catalogId: string;
  components: Record<string, Record<string, unknown>>;
}

export function extractCatalogComponentSchemas(
  catalog?: unknown,
): InlineCatalogSchema {
  const resolved = resolveCatalog(catalog);
  const components: Record<string, Record<string, unknown>> = {};
  for (const [name, comp] of resolved.components) {
    const zodSchema = toJsonSchema(comp.schema, {
      target: "jsonSchema2019-09",
    }) as { properties?: Record<string, unknown>; required?: string[] };
    components[name] = {
      allOf: [
        { $ref: "common_types.json#/$defs/ComponentCommon" },
        {
          properties: {
            component: { const: name },
            ...zodSchema.properties,
          },
          required: ["component", ...(zodSchema.required ?? [])],
        },
      ],
    };
  }
  return { catalogId: resolved.id, components };
}
