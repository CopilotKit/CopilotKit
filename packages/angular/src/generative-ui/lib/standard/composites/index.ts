import {
  compositeDeclarations,
  withComponents,
} from "@copilotkit/shared/generative-ui";
import { CopilotGenerativeUICitation } from "./citation";
import { CopilotGenerativeUIEntityCard } from "./entity-card";
import { CopilotGenerativeUIFollowUp } from "./follow-up";
import { CopilotGenerativeUIImageGrid } from "./image-grid";
import { CopilotGenerativeUILinkCard } from "./link-card";

export { CopilotGenerativeUICitation } from "./citation";
export { CopilotGenerativeUIEntityCard } from "./entity-card";
export { CopilotGenerativeUIFollowUp } from "./follow-up";
export { CopilotGenerativeUIImageGrid } from "./image-grid";
export { CopilotGenerativeUILinkCard } from "./link-card";

/**
 * The standard composite components.
 *
 * - LinkCard and EntityCard open `href`, or send `onClick` when it is bound.
 * - FollowUp sends `onFollowUp` with the message of the pill. Unbound, the
 *   engine turns it into a visible user message with that text.
 * - EntityCard buttons without href send `onAction` with their label.
 */
export const compositeComponents = withComponents(compositeDeclarations, {
  LinkCard: CopilotGenerativeUILinkCard,
  Citation: CopilotGenerativeUICitation,
  FollowUp: CopilotGenerativeUIFollowUp,
  EntityCard: CopilotGenerativeUIEntityCard,
  ImageGrid: CopilotGenerativeUIImageGrid,
});
