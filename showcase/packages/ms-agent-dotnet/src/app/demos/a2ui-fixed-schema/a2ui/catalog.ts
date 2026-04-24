"use client";

/**
 * Fixed A2UI catalog — wires definitions to renderers.
 *
 * `includeBasicCatalog: true` merges CopilotKit's built-in components
 * (Card, Column, Row, Text, Button, Divider, …) into this catalog, so
 * the agent's fixed schema (emitted server-side in
 * agent/A2uiFixedSchemaAgent.cs) can compose custom and basic components
 * interchangeably.
 */
import { createCatalog } from "@copilotkit/a2ui-renderer";

import { flightDefinitions } from "./definitions";
import { flightRenderers } from "./renderers";

export const CATALOG_ID = "copilotkit://flight-fixed-catalog";

// @region[catalog-creation]
export const fixedCatalog = createCatalog(flightDefinitions, flightRenderers, {
  catalogId: CATALOG_ID,
  includeBasicCatalog: true,
});
// @endregion[catalog-creation]
