import { computed, watch } from "vue";
import type { ShallowRef } from "vue";
import type { Catalog, ComponentApi } from "@a2ui/web_core/v0_9";
import { zodToJsonSchema } from "zod-to-json-schema";
import {
  A2UI_DEFAULT_GENERATION_GUIDELINES,
  A2UI_DEFAULT_DESIGN_GUIDELINES,
  schemaToJsonSchema,
} from "@copilotkit/shared";
import type { StandardSchemaV1 } from "@copilotkit/shared";
import type { CopilotKitCoreVue } from "../../lib/vue-core";
import { vueBasicCatalog } from "./catalog";

/**
 * Convert a catalog component's props schema to JSON Schema.
 *
 * Mirrors `catalogSchemaToJsonSchema` in @copilotkit/a2ui-renderer, duplicated
 * here rather than imported for the same reason as the schema-context constant
 * below: importing it would pull React into the Vue package.
 * `zodToJsonSchema` understands Zod v3 internals only and returns a bare
 * `{ $schema }` — no `properties`, no error — for the Zod v4 schemas an
 * application may legitimately build its catalog from, which silently strips
 * every prop from the catalog the model is shown.
 */
type ZodToJsonSchemaOptions = Extract<
  Parameters<typeof zodToJsonSchema>[1],
  Record<string, unknown>
>;

function toCatalogJsonSchema(
  schema: unknown,
  options?: ZodToJsonSchemaOptions,
): Record<string, unknown> {
  const isStandardSchema =
    typeof schema === "object" &&
    schema !== null &&
    "~standard" in schema &&
    typeof (schema as { "~standard": unknown })["~standard"] === "object";

  // Zod v3 releases before 3.24 predate Standard Schema, so there is nothing
  // for `schemaToJsonSchema` to dispatch on — convert those directly.
  if (!isStandardSchema) {
    return zodToJsonSchema(
      schema as Parameters<typeof zodToJsonSchema>[0],
      options,
    ) as Record<string, unknown>;
  }

  return schemaToJsonSchema(schema as StandardSchemaV1, {
    zodToJsonSchema: (zodSchema, injectedOptions) =>
      zodToJsonSchema(zodSchema as Parameters<typeof zodToJsonSchema>[0], {
        ...(injectedOptions as ZodToJsonSchemaOptions),
        ...options,
      }) as Record<string, unknown>,
  });
}

/**
 * Context description used to identify the A2UI component schema in
 * RunAgentInput.context.  Must match the constant in @ag-ui/a2ui-middleware
 * so the middleware can overwrite a frontend-provided schema with a
 * server-side one.
 *
 * Duplicated from @copilotkit/a2ui-renderer/catalog-utils to avoid pulling
 * in React dependencies.
 */
const A2UI_SCHEMA_CONTEXT_DESCRIPTION =
  "A2UI Component Schema — available components for generating UI surfaces. " +
  "Use these component names and properties when creating A2UI operations.";

/**
 * Build a context string describing the available A2UI catalog.
 * Vue-native equivalent of buildCatalogContextValue from a2ui-renderer.
 */
function buildCatalogContextValue(catalog?: Catalog<ComponentApi>): string {
  const resolved = catalog ?? vueBasicCatalog;
  const BASIC_CATALOG_ID =
    "https://a2ui.org/specification/v0_9/basic_catalog.json";
  const lines: string[] = [];
  lines.push("Available A2UI catalog:");

  if (resolved.id === BASIC_CATALOG_ID) {
    lines.push(`- ${resolved.id} (basic catalog)`);
    return lines.join("\n");
  }

  // Check if the resolved catalog extends the basic catalog
  let isSuperset = true;
  for (const name of vueBasicCatalog.components.keys()) {
    if (!resolved.components.has(name)) {
      isSuperset = false;
      break;
    }
  }

  // Identify custom components (not in basic catalog)
  const customNames: string[] = [];
  for (const name of resolved.components.keys()) {
    if (!vueBasicCatalog.components.has(name)) {
      customNames.push(name);
    }
  }

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
    const comp = resolved.components.get(name);
    if (!comp) continue;
    const jsonSchema = toCatalogJsonSchema(comp.schema);
    lines.push(`  - ${name}:`);
    lines.push(
      `    ${JSON.stringify(jsonSchema, null, 2).split("\n").join("\n    ")}`,
    );
  }

  return lines.join("\n");
}

/**
 * Extract component schemas from a catalog in A2UI v0.9 inline format.
 * Vue-native equivalent of extractCatalogComponentSchemas.
 */
function extractCatalogComponentSchemas(catalog?: Catalog<ComponentApi>): {
  catalogId: string;
  components: Record<string, Record<string, unknown>>;
} {
  const resolved = catalog ?? vueBasicCatalog;
  const components: Record<string, Record<string, unknown>> = {};

  for (const [name, comp] of resolved.components) {
    const zodSchema = toCatalogJsonSchema(comp.schema, {
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

/**
 * Registers agent context describing the available A2UI catalog, component
 * schemas, and generation/design guidelines.
 *
 * Vue-native equivalent of React's `<A2UICatalogContext>` component.
 * Call from the provider's setup function.
 */
export function registerA2UICatalogContext(
  copilotkit: ShallowRef<CopilotKitCoreVue>,
  options: {
    enabled: () => boolean;
    catalog: () => Catalog<ComponentApi> | undefined;
    includeSchema: () => boolean;
  },
): void {
  const contextValue = computed(() =>
    buildCatalogContextValue(options.catalog()),
  );

  // Register catalog capabilities context
  watch(
    [() => copilotkit.value, options.enabled, contextValue],
    ([core, isEnabled, value], _prev, onCleanup) => {
      if (!isEnabled) return;
      // Scope to the agents the runtime applies A2UI to (#5369), so other
      // agents on the endpoint don't receive the catalog payload.
      const agentIds = core.a2uiAgents;
      const id = core.addContext({
        description:
          "A2UI catalog capabilities: available catalog IDs and " +
          "custom component definitions the client can render.",
        value,
        ...(agentIds ? { agentIds } : {}),
      });
      onCleanup(() => core.removeContext(id));
    },
    { immediate: true },
  );

  // Register schema + generation/design guidelines
  const schemaValue = computed(() => {
    if (!options.includeSchema()) return null;
    return JSON.stringify(extractCatalogComponentSchemas(options.catalog()));
  });

  watch(
    [() => copilotkit.value, options.enabled, schemaValue],
    ([core, isEnabled, schema], _prev, onCleanup) => {
      if (!isEnabled || !schema) return;
      const agentIds = core.a2uiAgents;
      const scope = agentIds ? { agentIds } : {};
      const ids: string[] = [];
      ids.push(
        core.addContext({
          description: A2UI_SCHEMA_CONTEXT_DESCRIPTION,
          value: schema,
          ...scope,
        }),
      );
      ids.push(
        core.addContext({
          description:
            "A2UI generation guidelines — protocol rules, tool arguments, " +
            "path rules, data model format, and " +
            "form/two-way-binding instructions.",
          value: A2UI_DEFAULT_GENERATION_GUIDELINES,
          ...scope,
        }),
      );
      ids.push(
        core.addContext({
          description:
            "A2UI design guidelines — visual design rules, component " +
            "hierarchy tips, and action handler patterns.",
          value: A2UI_DEFAULT_DESIGN_GUIDELINES,
          ...scope,
        }),
      );
      onCleanup(() => {
        for (const id of ids) core.removeContext(id);
      });
    },
    { immediate: true },
  );
}
