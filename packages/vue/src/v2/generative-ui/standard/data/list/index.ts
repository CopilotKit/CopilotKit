import {
  dataDeclarations,
  withComponents,
} from "@copilotkit/shared/generative-ui";
import CopilotGenerativeUIList from "./List.vue";
import CopilotGenerativeUIListItem from "./ListItem.vue";

export { CopilotGenerativeUIList, CopilotGenerativeUIListItem };

/**
 * The standard list components: their declarations from the shared
 * catalog, with the Vue components. The data group spreads them into its
 * components.
 *
 * List and ListItem have an `action` event. The List event gets the index,
 * label and value of the picked item.
 *
 * @example
 * ```ts
 * const ui = createGenerativeUI({ components: { ...listComponents } });
 * ```
 */
export const listComponents = withComponents(
  { List: dataDeclarations.List, ListItem: dataDeclarations.ListItem },
  { List: CopilotGenerativeUIList, ListItem: CopilotGenerativeUIListItem },
);
