"use client";

import { CopilotKit } from "@copilotkit/react-core/v2";
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
  const { agent, lgcDeploymentUrl } = useModelSelectorContext();

  return (
    <CopilotKit
      runtimeUrl="/api/copilotkit"
      headers={
        lgcDeploymentUrl
          ? { "x-lgc-deployment-url": lgcDeploymentUrl }
          : undefined
      }
      showDevConsole={false}
      agent={agent}
      useSingleEndpoint={false}
    >
      <Main />
    </CopilotKit>
  );
}
