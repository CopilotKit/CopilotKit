import { createGenerativeUI } from "../catalog";
import { compositeComponents } from "./composites";
import { dataComponents } from "./data";
import { feedbackComponents } from "./feedback";
import { inputComponents } from "./inputs";
import { layoutComponents } from "./layout";
import { mediaComponents } from "./media";
import { textComponents } from "./text";
import {
  standardParameterOrder,
  STANDARD_ARGUMENT_PREFIXES,
} from "./parameter-order";
import { STANDARD_CATALOG_ID } from "./tokens";

const components = {
  ...layoutComponents,
  ...textComponents,
  ...inputComponents,
  ...feedbackComponents,
  ...dataComponents,
  ...mediaComponents,
  ...compositeComponents,
};

// Every standard component needs an intentional positional calling convention.
STANDARD_ARGUMENT_PREFIXES satisfies Record<
  keyof typeof components,
  readonly string[]
>;

const orderedComponents = Object.fromEntries(
  Object.entries(components).map(([name, definition]) => [
    name,
    {
      ...definition,
      parameterOrder: standardParameterOrder(
        name as keyof typeof components,
        definition,
      ),
    },
  ]),
) as {
  [Name in keyof typeof components]: (typeof components)[Name] & {
    parameterOrder: string[];
  };
};

/**
 * Experimental. The standard components: layout, text, inputs, feedback,
 * data, media and composites. Give it to the provider as it is, or add your
 * own components on top of it with `extends`.
 *
 * Style the components with the `--a2ui-*` CSS variables. Set them with
 * the `theme` option of `generativeUI`. The components have built-in dark
 * values, which apply under a `.dark` class, like the CopilotKit chat.
 *
 * Replace the React component of a standard component with `overrides`.
 * Drop standard components with `standardUI.omit([...])`.
 *
 * @example
 * ```tsx
 * <CopilotKitProvider runtimeUrl="/api/copilotkit" generativeUI={{ ui: standardUI }} />
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
