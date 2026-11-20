"use client";

import { useMemo } from "react";
import type { ReactNode } from "react";
import { CopilotKit } from "@copilotkit/react-core/v2";
import { standardUI } from "@copilotkit/react-core/v2/generative-ui";
import OMITTED from "@/lib/catalog-omit.json";
import { ModelProvider, useModel } from "@/lib/use-model";

// A2UI 1.0 with CopilotKit's standard catalog, cut down to what a dashboard,
// form or report needs. The runtime lists every component and its props in
// the guide it gives the agent, so a short catalog keeps that guide short and
// keeps the model on props that exist. The agent's Express path compiles
// against the same list (scripts/export-catalog.mjs writes it for the agent).
const canvasUI = standardUI.omit(
  OMITTED as Parameters<typeof standardUI.omit>[0],
);

const generativeUI = { ui: canvasUI };

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ModelProvider>
      <CopilotKitWithModel>{children}</CopilotKitWithModel>
    </ModelProvider>
  );
}

/** CopilotKit, sending the chosen model and path with every run as forwardedProps. */
function CopilotKitWithModel({ children }: { children: ReactNode }) {
  const { model, path } = useModel();
  const properties = useMemo(() => ({ model, path }), [model, path]);
  return (
    // REST transport: runtime info and runs both hit the multi-route endpoint.
    <CopilotKit
      runtimeUrl="/api/copilotkit"
      useSingleEndpoint={false}
      generativeUI={generativeUI}
      properties={properties}
      showDevConsole={false}
      enableInspector={false}
    >
      {children}
    </CopilotKit>
  );
}
