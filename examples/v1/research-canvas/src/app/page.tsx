"use client";

import { CopilotKitProvider } from "@copilotkit/react-core";
import Main from "./Main";
import {
  ModelSelectorProvider,
  useModelSelectorContext,
} from "@/lib/model-selector-provider";
import { ModelSelector } from "@/components/ModelSelector";

export default function ModelSelectorWrapper() {
  return (
    <ModelSelectorProvider>
      <Home />
      <ModelSelector />
    </ModelSelectorProvider>
  );
}

function Home() {
  const { agent } = useModelSelectorContext();

  return (
    <CopilotKitProvider
      runtimeUrl="/api/copilotkit"
      showDevConsole={false}
      agentId={agent}
      useSingleEndpoint={false}
    >
      <Main />
    </CopilotKitProvider>
  );
}
