"use client";

/**
 * Declarative Generative UI demo (A2UI, dynamic schema).
 *
 * 1. The sales dashboard catalog in `../_shared/a2ui-sales-dashboard/`
 *    defines branded React components with Zod schemas, on top of the basic
 *    A2UI catalog.
 * 2. The page passes the catalog to the provider with
 *    `<CopilotKit a2ui={{ catalog }}>`.
 * 3. The A2UI middleware serializes the catalog schema into the agent's
 *    context, so the agent knows which components it may use, and the agent
 *    generates the surface from them.
 *
 * Reference:
 *   https://docs.copilotkit.ai/integrations/langgraph/generative-ui/a2ui
 */
import { CopilotKit } from "@copilotkit/react-core/v2";
import { useDemoRuntimeUrl } from "@/lib/demo-runtime";

import { A2UIFormatFrame } from "../_shared/a2ui-format-frame";
import { catalogsByProtocol } from "../_shared/a2ui-sales-dashboard/catalog";
import { Chat } from "./chat";
import type { DeclarativeGenUiConfig } from "./config";

export function DeclarativeGenUiDemo({
  config,
}: {
  config: DeclarativeGenUiConfig;
}) {
  const runtimeUrl = useDemoRuntimeUrl("declarative-gen-ui");
  const catalog = catalogsByProtocol[config.catalogProtocol];
  return (
    <A2UIFormatFrame selector={config.formatSelector}>
      {(properties) => (
        // @region[provider-a2ui-prop]
        <CopilotKit
          runtimeUrl={runtimeUrl}
          agent="declarative-gen-ui"
          a2ui={{ catalog }}
          properties={properties}
        >
          <div className="flex justify-center items-center h-full w-full">
            <div className="h-full w-full max-w-4xl">
              <Chat />
            </div>
          </div>
        </CopilotKit>
        // @endregion[provider-a2ui-prop]
      )}
    </A2UIFormatFrame>
  );
}
