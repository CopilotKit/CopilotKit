import {
  dataDeclarations,
  withComponents,
} from "@copilotkit/shared/generative-ui";
import CopilotGenerativeUIMap from "./Map.vue";

export { CopilotGenerativeUIMap };

/**
 * The standard `Map` component: its declaration from the shared catalog,
 * with the Vue component. `selected` is writable, so a `{ "@path" }` binding
 * gets the choice of the user. The data group spreads it into its
 * components.
 *
 * Without the `/map` plugin, Map shows its markers as a list.
 *
 * @example
 * ```ts
 * const ui = createGenerativeUI({ components: { ...mapComponent } });
 * ```
 */
export const mapComponent = withComponents(
  { Map: dataDeclarations.Map },
  { Map: CopilotGenerativeUIMap },
);
