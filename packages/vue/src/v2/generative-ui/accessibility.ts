import { computed, inject } from "vue";
import { accessibilityAttributes } from "@copilotkit/core/generative-ui";
import { GenerativeUINodeKey } from "./runtime-context";

// The accessibility helpers are framework-free and live in
// `@copilotkit/core/generative-ui`. The standard components import them
// from here.
export {
  accessibilityAttributes,
  controlAria,
  namedRole,
  readAccessibility,
  wrapperAria,
} from "@copilotkit/core/generative-ui";
export type {
  GenerativeUIAccessibility,
  GenerativeUIAriaAttributes,
} from "@copilotkit/core/generative-ui";

/**
 * Experimental. The ARIA attributes of the `accessibility` that the model
 * gave the component being rendered, as a computed ref to bind on its root
 * element. The standard components do this. A custom component does it
 * itself:
 *
 * @example
 * ```vue
 * <script setup lang="ts">
 * import { useGenerativeUIAccessibility } from "@copilotkit/vue/v2/generative-ui";
 *
 * const aria = useGenerativeUIAccessibility();
 * </script>
 *
 * <template>
 *   <section v-bind="aria"><slot /></section>
 * </template>
 * ```
 *
 * Outside of generated UI its value is `{}`.
 */
export function useGenerativeUIAccessibility() {
  const node = inject(GenerativeUINodeKey, null);
  return computed(() => accessibilityAttributes(node?.value.accessibility));
}
