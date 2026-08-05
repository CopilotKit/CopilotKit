"use client";

import React from "react";
import { CopilotKit } from "@copilotkit/react-core/v2";
import { myCatalog } from "../declarative-gen-ui/a2ui/catalog";
import { Chat } from "./chat";

export default function A2uiRecoveryDemo() {
  return (
    <CopilotKit
      runtimeUrl="/api/copilotkit-a2ui-recovery"
      agent="a2ui-recovery"
      a2ui={{ catalog: myCatalog }}
    >
      <div className="flex justify-center items-center h-screen w-full">
        <div className="h-full w-full max-w-4xl">
          <Chat />
        </div>
      </div>
    </CopilotKit>
  );
}
