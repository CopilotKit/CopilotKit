"use client";

import { CopilotKit } from "@copilotkit/react-core";
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

  // This logic is implemented to demonstrate multi-agent frameworks in this demo project.
  // There are cleaner ways to handle this in a production environment.
  const runtimeUrl = lgcDeploymentUrl
    ? `/api/copilotkit?lgcDeploymentUrl=${lgcDeploymentUrl}`
    : `/api/copilotkit${
        agent.includes("crewai") ? "?coAgentsModel=crewai" : ""
      }`;

  return (
    <CopilotKit runtimeUrl={runtimeUrl} showDevConsole={false} agent={agent}>
      <Main />
    </CopilotKit>
  );
}
