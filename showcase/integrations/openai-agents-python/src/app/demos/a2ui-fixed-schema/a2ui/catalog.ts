"use client";

/**
 * Fixed A2UI catalog — wires definitions to renderers.
 *
 * `extends: [standardUI...]` merges CopilotKit's standard components
 * (Card, Column, Row, Text, Button, Divider, …) into this catalog, so
 * the agent's fixed schema (src/demo_agents/a2ui_schemas/flight_schema.json) can
 * compose custom and standard components interchangeably. `omit` drops the
 * standard components that this catalog replaces.
 */
// @region[catalog-creation]

import { definitions } from "./definitions";
import { renderers } from "./renderers";
import { createGenerativeUI, standardUI } from "@copilotkit/react-core/generative-ui";

export const CATALOG_ID = "copilotkit://flight-fixed-catalog";

export const catalog = createGenerativeUI({
  id: CATALOG_ID,
  extends: [standardUI.omit(["Card", "Title", "Button"])],
  components: {
    Card: {
      component: renderers.Card,
      ...definitions.Card,
    },
    Title: {
      component: renderers.Title,
      ...definitions.Title,
    },
    Airport: {
      component: renderers.Airport,
      ...definitions.Airport,
    },
    Arrow: {
      component: renderers.Arrow,
      ...definitions.Arrow,
    },
    AirlineBadge: {
      component: renderers.AirlineBadge,
      ...definitions.AirlineBadge,
    },
    PriceTag: {
      component: renderers.PriceTag,
      ...definitions.PriceTag,
    },
    Button: {
      component: renderers.Button,
      ...definitions.Button,
    },
  },
});
// @endregion[catalog-creation]
