/**
 * The assembled A2UI catalog + activity-message renderer for this
 * Slack app.
 *
 * `catalogId` MUST match the agent's `CATALOG_ID` constant
 * (`packages/slack/agent/src/agents/a2ui_fixed.py`) — that's how the
 * activity renderer routes incoming a2ui-surface events to this catalog.
 *
 * Wire into the bridge via:
 *
 *     createSlackBridge({
 *       // ...
 *       renderActivityMessages: [flightActivityRenderer],
 *     });
 */
import {
  createCatalog,
  createA2UIActivityRenderer,
} from "../../src/index.js";
import { flightDefinitions, flightRenderers } from "./renderers.js";

export const flightCatalog = createCatalog(
  flightDefinitions,
  flightRenderers,
  { catalogId: "copilotkit://flight-fixed-catalog" },
);

export const flightActivityRenderer = createA2UIActivityRenderer({
  catalog: flightCatalog,
});
