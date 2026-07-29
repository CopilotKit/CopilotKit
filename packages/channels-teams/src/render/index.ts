// Managed reuse surface for @copilotkit/channels-teams: the render + run-renderer
// primitives, published under the `./render` subpath so managed hosts can
// reuse Teams rendering without importing the full adapter surface.

export {
  renderAdaptiveCard,
  isPlainText,
  collectPlainText,
  ADAPTIVE_CARD_CONTENT_TYPE,
} from "./adaptive-card.js";
export { renderNativeAdaptiveCard } from "./native-adaptive-card.js";
export {
  assertAdaptiveCardPayload,
  TEAMS_SCHEMA_LOCK,
  TEAMS_CARD_SCHEMA_URL,
  TEAMS_CARD_VERSION,
} from "./schema.js";
export type { AdaptiveCardPayload } from "./schema.js";
export { createRunRenderer } from "../event-renderer.js";
