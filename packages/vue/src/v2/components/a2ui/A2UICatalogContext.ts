import { watch } from "vue";
import type { ShallowRef } from "vue";
import type { Catalog, ComponentApi } from "@a2ui/web_core/v0_9";
import { A2UICatalogController } from "@copilotkit/a2ui-renderer/catalog-schema";
import type { CopilotKitCoreVue } from "../../lib/vue-core";
import { vueBasicCatalog } from "./catalog";

/**
 * Keeps the provider's A2UI catalog in sync with core through the shared
 * `A2UICatalogController`: registers its components (so the Inspector can
 * toggle them), reports the catalog with disabled components removed, and
 * registers the agent context entries scoped to `core.a2uiAgents` while A2UI
 * is on. Call from the provider's setup function.
 *
 * @param copilotkit - The provider's core.
 * @param options.onFilteredCatalog - Receives the filtered catalog each time
 *   it changes; the provider renders surfaces with it.
 */
export function registerA2UICatalog(
  copilotkit: ShallowRef<CopilotKitCoreVue>,
  options: {
    enabled: () => boolean;
    catalog: () => Catalog<ComponentApi> | undefined;
    includeSchema: () => boolean;
    onFilteredCatalog: (catalog: Catalog<ComponentApi> | undefined) => void;
  },
): void {
  watch(
    () => copilotkit.value,
    (core, _previous, onCleanup) => {
      const controller = new A2UICatalogController<Catalog<ComponentApi>>(
        core,
        vueBasicCatalog,
      );
      const unsubscribe = controller.subscribe(() =>
        options.onFilteredCatalog(controller.getSnapshot()),
      );
      const stop = watch(
        [options.enabled, options.catalog, options.includeSchema],
        ([enabled, catalog, includeSchema]) =>
          controller.update({ enabled, catalog, includeSchema }),
        { immediate: true },
      );
      onCleanup(() => {
        stop();
        unsubscribe();
        controller.dispose();
      });
    },
    { immediate: true },
  );
}
