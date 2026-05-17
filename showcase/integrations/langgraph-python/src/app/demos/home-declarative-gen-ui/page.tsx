"use client";

/**
 * Homepage: Declarative Gen UI — bare-minimum A2UI catalog wiring.
 *
 * Reuses the `declarative-gen-ui` LangGraph backend, the dedicated
 * `/api/copilotkit-declarative-gen-ui` runtime, and the canonical catalog
 * from /demos/declarative-gen-ui. Strips suggestions and layout wrapper.
 *
 * This is the bare minimum: declare a catalog, pass it to <CopilotKit
 * a2ui={{ catalog }} />, drop in <CopilotChat />, done. The agent
 * assembles UI trees from the catalog primitives.
 *
 * Iframe target for the "Declarative Gen UI" chip on the website
 * homepage dojo.
 */

import { CopilotKit, CopilotChat } from "@copilotkit/react-core/v2";

import { myCatalog } from "../declarative-gen-ui/a2ui/catalog";

export default function HomeDeclarativeGenUiDemo() {
  return (
    <CopilotKit
      runtimeUrl="/api/copilotkit-declarative-gen-ui"
      agent="declarative-gen-ui"
      a2ui={{ catalog: myCatalog }}
    >
      <CopilotChat agentId="declarative-gen-ui" />
    </CopilotKit>
  );
}
