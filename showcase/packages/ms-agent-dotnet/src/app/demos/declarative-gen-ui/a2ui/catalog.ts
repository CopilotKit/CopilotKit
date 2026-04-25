/**
 * A2UI catalog DECLARATION.
 *
 * Wires `myDefinitions` (component schemas) × `myRenderers` (React
 * implementations) into a Catalog the provider consumes via
 * `a2ui={{ catalog: myCatalog }}`. `includeBasicCatalog: true` merges
 * CopilotKit's built-in A2UI primitives (Column, Row, Text, Image,
 * Card, Button, List, Tabs, …) so the agent can compose custom + basic
 * components interchangeably.
 *
 * Reference:
 *   https://docs.copilotkit.ai/integrations/microsoft-agent-framework/generative-ui/a2ui
 */
import { createCatalog } from "@copilotkit/a2ui-renderer";

import { myDefinitions } from "./definitions";
import { myRenderers } from "./renderers";

// @region[create-catalog]
export const myCatalog = createCatalog(myDefinitions, myRenderers, {
  catalogId: "declarative-gen-ui-catalog",
  includeBasicCatalog: true,
});
// @endregion[create-catalog]
