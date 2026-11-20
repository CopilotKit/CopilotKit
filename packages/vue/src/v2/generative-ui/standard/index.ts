import {
  STANDARD_CATALOG_ID,
  withStandardParameterOrder,
} from "@copilotkit/shared/generative-ui";
import { createGenerativeUI } from "../catalog";
import { compositeComponents } from "./composites";
import { dataComponents } from "./data";
import { feedbackComponents } from "./feedback";
import { inputComponents } from "./inputs";
import { layoutComponents } from "./layout";
import { mediaComponents } from "./media";
import { textComponents } from "./text";

const orderedComponents = withStandardParameterOrder({
  ...layoutComponents,
  ...textComponents,
  ...inputComponents,
  ...feedbackComponents,
  ...dataComponents,
  ...mediaComponents,
  ...compositeComponents,
});

/**
 * Experimental. The standard components: layout, text, inputs, feedback,
 * data, media and composites, as native Vue components. Give it to the
 * provider as it is, or add your own components on top of it with
 * `extends`.
 *
 * Style the components with the `--a2ui-*` CSS variables. Set them with
 * the `theme` option of `generativeUI`. The components have built-in dark
 * values, which apply under a `.dark` class, like the CopilotKit chat.
 *
 * Replace the Vue component of a standard component with `overrides`.
 * Drop standard components with `standardUI.omit([...])`.
 *
 * Chart and Map need their optional libraries. Install the plugins from
 * the `@copilotkit/vue/v2/generative-ui/chart` and `/map` entries:
 * `app.use(GenerativeUIChart)` and `app.use(GenerativeUIMap)`. Without
 * them, Chart renders its data as a table and Map renders its markers as
 * a list.
 *
 * @example
 * ```vue
 * <CopilotKitProvider runtime-url="/api/copilotkit" :generativeUI="{ ui: standardUI }">
 *   <CopilotChat />
 * </CopilotKitProvider>
 * ```
 *
 * @example
 * ```ts
 * import MyCard from "./MyCard.vue";
 * import ProductCard from "./ProductCard.vue";
 *
 * const ui = createGenerativeUI({
 *   id: "acme/app@1",
 *   extends: [standardUI.omit(["Map"])],
 *   overrides: { Card: { component: MyCard } },
 *   components: { ProductCard: { component: ProductCard, props: productSchema } },
 * });
 * ```
 */
export const standardUI = createGenerativeUI({
  id: STANDARD_CATALOG_ID,
  components: orderedComponents,
});
