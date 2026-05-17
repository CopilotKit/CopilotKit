/**
 * Assembled A2UI surface for this Slack app — both fixed-schema flight
 * catalog AND dynamic-schema dashboard catalog wired through one
 * activity-message renderer.
 *
 * `catalogId`s here MUST match the agent's constants:
 *   - copilotkit://flight-fixed-catalog → a2ui_fixed.py
 *   - copilotkit://app-dashboard-catalog → a2ui_dynamic.py
 * That's how the activity-renderer routes incoming surfaces to the
 * right catalog.
 *
 * Wire into the bridge via:
 *
 *     createSlackBridge({
 *       context: [...defaultSlackContext, dashboardSchemaContext],
 *       renderActivityMessages: [a2uiActivityRenderer],
 *     });
 */
import {
  createA2UIActivityRenderer,
  a2uiSchemaContext,
} from "../../src/index.js";
import { flightCatalog } from "./renderers.js";
import { dashboardCatalog } from "./dashboard.js";

// Single activity renderer drives both catalogs — surfaces route by
// catalogId. Lets the same Slack bot serve both fixed-schema flight
// surfaces (a2ui_fixed graph) and dynamic-LLM-generated dashboard
// surfaces (a2ui_dynamic graph) without re-wiring.
export const a2uiActivityRenderer = createA2UIActivityRenderer({
  catalog: [flightCatalog, dashboardCatalog],
});

// Context entry advertising both catalogs to the agent's secondary
// LLM (dynamic mode) or to a curious primary LLM (fixed mode). The
// A2UI middleware in `@ag-ui/a2ui-middleware` looks for context
// entries with the canonical description and surfaces them to the
// agent.
export const a2uiSchema = a2uiSchemaContext([flightCatalog, dashboardCatalog]);

export { flightCatalog, dashboardCatalog };
