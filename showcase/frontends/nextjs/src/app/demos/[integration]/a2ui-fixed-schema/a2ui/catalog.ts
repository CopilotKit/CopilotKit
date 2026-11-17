"use client";

/**
 * The fixed flight-card A2UI catalog: definitions wired to renderers.
 *
 * `includeBasicCatalog: true` merges CopilotKit's built-in components (Card,
 * Column, Row, Text, Button, Divider, ...) into this catalog, so the agent's
 * fixed flight schema can mix custom and basic components.
 */
// @region[catalog-creation]
import { createCatalog } from "@copilotkit/a2ui-renderer";

import { definitions } from "./definitions";
import { renderers } from "./renderers";

export const CATALOG_ID = "copilotkit://flight-fixed-catalog";

export const catalog = createCatalog(definitions, renderers, {
  catalogId: CATALOG_ID,
  includeBasicCatalog: true,
});
// @endregion[catalog-creation]
