import {
  compositeDeclarations,
  withComponents,
} from "@copilotkit/shared/generative-ui";
import CopilotGenerativeUICitation from "./Citation.vue";
import CopilotGenerativeUIEntityCard from "./EntityCard.vue";
import CopilotGenerativeUIFollowUp from "./FollowUp.vue";
import CopilotGenerativeUIImageGrid from "./ImageGrid.vue";
import CopilotGenerativeUILinkCard from "./LinkCard.vue";

export {
  CopilotGenerativeUICitation,
  CopilotGenerativeUIEntityCard,
  CopilotGenerativeUIFollowUp,
  CopilotGenerativeUIImageGrid,
  CopilotGenerativeUILinkCard,
};

/**
 * The standard composite components: the prebuilt widgets the model places
 * with one object instead of many primitives. Spread them into the
 * components of `createGenerativeUI`.
 *
 * - LinkCard and EntityCard open `href`, or send `onClick` when it is bound.
 * - FollowUp sends `onFollowUp` with the message of the pill. Unbound, the
 *   engine turns it into a visible user message with that text.
 * - EntityCard buttons without href send `onAction` with their label.
 *
 * @example
 * ```ts
 * const ui = createGenerativeUI({ components: { ...compositeComponents } });
 * ```
 */
export const compositeComponents = withComponents(compositeDeclarations, {
  LinkCard: CopilotGenerativeUILinkCard,
  Citation: CopilotGenerativeUICitation,
  FollowUp: CopilotGenerativeUIFollowUp,
  EntityCard: CopilotGenerativeUIEntityCard,
  ImageGrid: CopilotGenerativeUIImageGrid,
});
