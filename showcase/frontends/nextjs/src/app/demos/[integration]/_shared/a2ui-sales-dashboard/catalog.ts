/**
 * The sales dashboard A2UI catalog: `myDefinitions` (component schemas) wired
 * to `myRenderers` (React implementations). A page passes it to the provider
 * with `<CopilotKit a2ui={{ catalog }}>`.
 *
 * `includeBasicCatalog: true` merges CopilotKit's built-in A2UI primitives
 * (Image, Button, List, Tabs, ...) into the catalog, so the agent can mix
 * custom and basic components. A custom entry with the name of a basic
 * component replaces it.
 *
 * Reference:
 *   https://docs.copilotkit.ai/integrations/langgraph/generative-ui/a2ui
 */
// @region[create-catalog]
import { createCatalog } from "@copilotkit/a2ui-renderer";

import { myDefinitions } from "./definitions";
import { myRenderers } from "./renderers";

export const myCatalog = createCatalog(myDefinitions, myRenderers, {
  catalogId: "declarative-gen-ui-catalog",
  includeBasicCatalog: true,
});
// @endregion[create-catalog]

/**
 * The same catalog on A2UI protocol 1.0. The protocol of the catalog decides
 * which basic catalog renders a surface and which generation guidelines the
 * agent receives, so it must match the operations that the agent generates.
 */
export const myCatalogV1 = createCatalog(myDefinitions, myRenderers, {
  catalogId: "declarative-gen-ui-catalog",
  includeBasicCatalog: true,
  protocolVersion: "1.0",
});

/** The catalog for each A2UI protocol version. */
export const catalogsByProtocol = {
  "v0.9": myCatalog,
  "1.0": myCatalogV1,
};

/** An A2UI protocol version that the sales dashboard catalog supports. */
export type SalesCatalogProtocol = keyof typeof catalogsByProtocol;
