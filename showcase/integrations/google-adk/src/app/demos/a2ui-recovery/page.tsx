"use client";

/**
 * Backend-owned A2UI recovery: the runtime disables tool injection and the
 * ADK adapter validates and retries the selected inference format. Express
 * compiles progressive model text; Direct JSON uses the legacy tool reply.
 * The two fixtures exercise invalid-then-valid output and exhaustion.
 */

import React from "react";
import { A2UIFormat } from "../../../../_shared/ts/a2ui-format";
import { CopilotKitProvider } from "@copilotkit/react-core";

// Reuse the declarative-gen-ui catalog (same components, same catalogId).
import { myCatalog } from "../declarative-gen-ui/a2ui/catalog";
import { Chat } from "./chat";

export default function A2uiRecoveryDemo() {
  return (
    <A2UIFormat>
      {(inferenceFormat) => (
        <CopilotKitProvider
          properties={{ a2ui: { inferenceFormat } }}
          runtimeUrl="/api/copilotkit-a2ui-recovery"
          agentId="a2ui-recovery"
          generativeUI={{ ui: myCatalog }}
        >
          <div className="flex justify-center items-center h-full w-full">
            <div className="h-full w-full max-w-4xl">
              <Chat />
            </div>
          </div>
        </CopilotKitProvider>
      )}
    </A2UIFormat>
  );
}
