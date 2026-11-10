<script lang="ts">
import type { AnyGenerativeUI } from "@copilotkit/shared/generative-ui";
import type { GenerativeUIComponentName } from "./catalog";

/**
 * Experimental. The props of `GenerativeUISurface`. `components` takes the
 * names of `ui`.
 */
export interface GenerativeUISurfaceProps<
  UI extends AnyGenerativeUI = AnyGenerativeUI,
> {
  /** Target id the agent renders into. */
  id: string;
  /**
   * Tells the model where this surface is and what to show in it, for
   * example "Next to the product list. Use it for product recommendations."
   */
  description?: string;
  /**
   * The UI of the provider (`generativeUI.ui`). It types the names in
   * `components`.
   */
  ui?: UI;
  /**
   * The only components that the agent can use in this surface, the root
   * included. The agent gets the list, and an operation with another
   * component is rejected. Left out, every component of the UI is allowed.
   */
  components?: readonly GenerativeUIComponentName<UI>[];
  /**
   * Scrolls the page to this surface when the agent starts to render into
   * it, unless the surface is already on screen. Defaults to `true`. With a
   * sticky header, give the surface a `scroll-margin-top`
   * (`[data-generative-ui-surface] { scroll-margin-top: 5rem }`).
   */
  autoScroll?: boolean;
}
</script>

<script setup lang="ts" generic="UI extends AnyGenerativeUI = AnyGenerativeUI">
/**
 * Experimental. A named place on the page where the agent can render UI.
 * The default slot is the fallback, shown until a surface targets this id.
 * Attributes such as `class` go to the element around the surface.
 *
 * @example
 * ```vue
 * <GenerativeUISurface
 *   id="products"
 *   :ui="storeUI"
 *   description="The product list. Show the products that the user asks for."
 *   :components="['ProductRow', 'ProductCard']"
 * >
 *   <FeaturedProducts />
 * </GenerativeUISurface>
 * ```
 */
import { computed, onMounted, ref, watch } from "vue";
import {
  allowedComponents,
  scrollToSurface,
} from "@copilotkit/core/generative-ui";
import { useManagerVersion } from "./hooks";
import { useRequiredGenerativeUIRuntime } from "./runtime-context";
import { SurfaceView } from "./SurfaceView";

defineOptions({ name: "GenerativeUISurface", inheritAttrs: false });
const props = withDefaults(defineProps<GenerativeUISurfaceProps<UI>>(), {
  autoScroll: true,
});
defineSlots<{ default?: () => unknown }>();

const isDevelopment = () => process.env.NODE_ENV !== "production";

const runtime = useRequiredGenerativeUIRuntime();
const version = useManagerVersion(runtime);
const element = ref<HTMLElement | null>(null);

const surface = computed(() => {
  void version.value;
  return runtime.value.manager.getSurfaceForTarget(props.id);
});
// Every render_ui call (and every streaming markdown fence) sets the status
// to "streaming", for a new surface and for an update. The key is set only
// while the surface streams, so each start scrolls once. The manager
// changes the status of a surface in place, so it is read on every change.
const generatingKey = computed(() => {
  void version.value;
  const current = runtime.value.manager.getSurfaceForTarget(props.id);
  return current?.status === "streaming" ? current.key : undefined;
});
// A new array with the same names must not register the target again.
const componentsKey = computed(() =>
  props.components === undefined ? undefined : JSON.stringify(props.components),
);
let warnedKey: string | undefined;

// After mount, as React's layout effects: the server registers nothing.
onMounted(() => {
  // The agent renders only the components of the provider's UI, so the
  // names are checked against it. A different `ui` is a setup mistake.
  watch(
    [
      () => props.ui !== undefined && props.ui !== runtime.value.ui,
      () => props.id,
    ],
    ([otherUI, id]) => {
      if (otherUI && isDevelopment()) {
        console.warn(
          `[generativeUI] <GenerativeUISurface id="${id}">: the ui prop is not the UI of the provider (generativeUI.ui). The components are checked against the UI of the provider.`,
        );
      }
    },
    { immediate: true },
  );
  watch(
    [runtime, () => props.id, () => props.description, componentsKey],
    ([current, id, description, key], _previous, onCleanup) => {
      const requested = props.components;
      // The engine's `ui` type takes function and class components only.
      const ui: AnyGenerativeUI = current.ui;
      const allowed =
        requested === undefined ? undefined : allowedComponents(requested, ui);
      const shouldWarn =
        allowed !== undefined &&
        allowed.warning !== "" &&
        warnedKey !== key &&
        isDevelopment();
      if (shouldWarn) {
        warnedKey = key;
        console.warn(
          `[generativeUI] <GenerativeUISurface id="${id}">: ${allowed.warning}.`,
        );
      }
      onCleanup(
        current.manager.registerTarget(id, {
          description,
          components: allowed?.names,
        }),
      );
    },
    { immediate: true },
  );
  watch(
    [generatingKey, () => props.autoScroll],
    ([key, autoScroll]) => {
      // Post flush: the element of a new surface is in the DOM by now.
      const target = element.value;
      if (autoScroll && key && target) scrollToSurface(target);
    },
    { immediate: true, flush: "post" },
  );
});
</script>

<template>
  <div
    v-if="surface"
    ref="element"
    v-bind="$attrs"
    :data-generative-ui-surface="id"
  >
    <SurfaceView :surface="surface" />
  </div>
  <slot v-else />
</template>
