"use client";

/**
 * Homepage: Declarative Gen UI — bare-minimum A2UI catalog wiring,
 * styled in the experimental "lavender glass" design language.
 *
 * Reuses the `declarative-gen-ui` LangGraph backend, the dedicated
 * /api/copilotkit-declarative-gen-ui runtime, and the canonical
 * `myCatalog` from /demos/declarative-gen-ui. The agent's UI tree
 * still uses the catalog's primitives — but the chat shell around it
 * carries the experimental theme so the iframe preview on the
 * homepage dojo matches the surrounding design.
 *
 * Iframe target for the "Declarative Gen UI" chip on the homepage dojo.
 */

import {
  CopilotKit,
  CopilotChat,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";

import { myCatalog } from "../declarative-gen-ui/a2ui/catalog";
import "../_experimental-theme/theme.css";

function Chat() {
  useConfigureSuggestions({
    suggestions: [
      {
        title: "Lost-baggage tracker",
        message:
          "Surface a lost-baggage tracker for bag #4421 last seen at ATL.",
      },
      {
        title: "Settings card",
        message: "Design a settings card with notifications + theme toggles.",
      },
      {
        title: "Onboarding checklist",
        message: "Compose an onboarding checklist with three steps.",
      },
    ],
    available: "always",
  });

  return <CopilotChat agentId="declarative-gen-ui" className="h-full" />;
}

export default function HomeDeclarativeGenUiDemo() {
  return (
    <CopilotKit
      runtimeUrl="/api/copilotkit-declarative-gen-ui"
      agent="declarative-gen-ui"
      a2ui={{ catalog: myCatalog }}
      enableInspector={false}
    >
      <div className="hd-exp-scope h-screen w-screen overflow-hidden">
        <Chat />
      </div>
    </CopilotKit>
  );
}
