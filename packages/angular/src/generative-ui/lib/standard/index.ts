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
 * data, media and composites, as native Angular components. Give it to
 * `provideGenerativeUI({ ui: standardUI })` as it is, or add your own
 * components on top of it with `extends`.
 *
 * Style the components with the `--a2ui-*` CSS variables. Set them with
 * the `theme` option of `provideGenerativeUI`. The components have built-in
 * dark values, which apply under a `.dark` class, like the CopilotKit chat.
 *
 * Replace the component of a standard component with `overrides`. Drop
 * standard components with `standardUI.omit([...])`. Chart, Map and Icon
 * need their optional libraries: `provideGenerativeUIChart()`,
 * `provideGenerativeUIMap()` and `provideGenerativeUIIcons()` from the
 * `/generative-ui/chart`, `/map` and `/icons` entries; without them they
 * render their fallbacks.
 *
 * @example
 * ```ts
 * provideGenerativeUI({ ui: standardUI })
 *
 * export const ui = createGenerativeUI({
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
