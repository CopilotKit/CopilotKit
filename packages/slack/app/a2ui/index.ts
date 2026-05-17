/**
 * The assembled A2UI catalog + activity-message renderer for this
 * Slack app.
 *
 * Wire into the bridge via:
 *
 *     createSlackBridge({
 *       // ...
 *       renderActivityMessages: [dashboardActivityRenderer],
 *     });
 *
 * The `catalogId` here MUST match the `catalog_id` the agent uses in
 * its `a2ui.create_surface(..., catalog_id=...)` calls — that's how
 * the bridge routes incoming a2ui operations to this catalog. Keep
 * the URI stable; changing it later breaks any agent prompts that
 * embed the id literally.
 */
import { createCatalog, createA2UIActivityRenderer } from "../../src/index.js";
import { dashboardDefinitions, dashboardRenderers } from "./renderers.js";

export const dashboardCatalog = createCatalog(
  dashboardDefinitions,
  dashboardRenderers,
  { catalogId: "copilotkit://app-dashboard-catalog" },
);

export const dashboardActivityRenderer = createA2UIActivityRenderer({
  catalog: dashboardCatalog,
});
