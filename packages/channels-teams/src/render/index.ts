// Managed reuse surface for @copilotkit/channels-teams: the render + run-renderer
// primitives, published under the `./render` subpath so managed hosts can
// reuse Teams rendering without importing the full adapter surface.

export {
  renderAdaptiveCard,
  isPlainText,
  collectPlainText,
  ADAPTIVE_CARD_CONTENT_TYPE,
} from "./adaptive-card.js";
export { createRunRenderer } from "../event-renderer.js";
