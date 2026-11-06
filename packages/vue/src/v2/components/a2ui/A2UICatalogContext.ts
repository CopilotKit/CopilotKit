import { computed, watch } from "vue";
import type { ShallowRef } from "vue";
import type { Catalog, ComponentApi } from "@a2ui/web_core/v0_9";
import {
  A2UI_DEFAULT_GENERATION_GUIDELINES,
  A2UI_DEFAULT_DESIGN_GUIDELINES,
  A2UI_SCHEMA_CONTEXT_DESCRIPTION,
  buildA2UICatalogContextValue,
  extractA2UICatalogSchemas,
} from "@copilotkit/shared";
import type { CopilotKitCoreVue } from "../../lib/vue-core";
import { vueBasicCatalog } from "./catalog";

const basicComponentNames: ReadonlySet<string> = new Set(
  vueBasicCatalog.components.keys(),
);

/**
 * Build a context string describing the available A2UI catalog.
 * Vue-native equivalent of buildCatalogContextValue from a2ui-renderer.
 *
 * When `options.includeSchema` is `false`, custom components are listed by name
 * only and their JSON schemas are omitted.
 */
export function buildCatalogContextValue(
  catalog?: Catalog<ComponentApi>,
  options?: { includeSchema?: boolean },
): string {
  return buildA2UICatalogContextValue(
    catalog ?? vueBasicCatalog,
    basicComponentNames,
    options,
  );
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
  // Custom component schemas reach the model through the Component Schema
  // entry, so the capabilities entry only names the components.
  const contextValue = computed(() =>
    buildCatalogContextValue(options.catalog(), { includeSchema: false }),
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
    return JSON.stringify(
      extractA2UICatalogSchemas(options.catalog() ?? vueBasicCatalog),
    );
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
