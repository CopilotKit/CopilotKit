"use client";

/**
 * Fixed A2UI catalog — wires definitions to renderers.
 *
 * `includeBasicCatalog: true` merges CopilotKit's built-in components
 * (Card, Column, Row, Text, Button, Divider, …) into this catalog, so
 * the agent's fixed schema (src/agents/a2ui_schemas/flight_schema.json) can
 * compose custom and basic components interchangeably.
 */
import { createCatalog } from "@copilotkit/a2ui-renderer";

import { definitions } from "./definitions";
import { renderers } from "./renderers";

export const CATALOG_ID = "copilotkit://flight-fixed-catalog";

// @region[catalog-creation]
export const catalog = createCatalog(definitions, renderers, {
  catalogId: CATALOG_ID,
  includeBasicCatalog: true,
});
// @endregion[catalog-creation]
