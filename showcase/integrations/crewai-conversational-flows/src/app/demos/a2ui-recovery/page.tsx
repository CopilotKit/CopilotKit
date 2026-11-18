"use client";

import React from "react";
import { CopilotKitProvider } from "@copilotkit/react-core";
import { myCatalog } from "../declarative-gen-ui/a2ui/catalog";
import { Chat } from "./chat";

export default function A2uiRecoveryDemo() {
  return (
    <CopilotKitProvider
      runtimeUrl="/api/copilotkit-a2ui-recovery"
      agentId="a2ui-recovery"
      generativeUI={{ ui: myCatalog }}
    >
      <div className="flex justify-center items-center h-screen w-full">
        <div className="h-full w-full max-w-4xl">
          <Chat />
        </div>
      </div>
    </CopilotKitProvider>
  );
}
