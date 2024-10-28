"use client";

import { CopilotKit } from "@copilotkit/react-core";
import Main from "./Main";
import { ModelSelectorProvider } from "@/lib/model-selector-provider";
import { ModelSelector } from "@/components/ModelSelector";

export default function Home() {
  return (
    <ModelSelectorProvider>
      {/* <CopilotKit
        runtimeUrl="/api/copilotkit"
        showDevConsole={false}
        agent="research_agent"
      > */}
        <Main />
      {/* </CopilotKit> */}
      <ModelSelector />
    </ModelSelectorProvider>
  );
}
