"use client";

import { ModelSelector } from "@/components/ModelSelector";
import { ResearchWrapper } from "@/components/ResearchWrapper";
import { ModelSelectorProvider, useModelSelectorContext } from "@/lib/model-selector-provider";
import { ResearchProvider } from "@/lib/research-provider";
import { CopilotKit } from "@copilotkit/react-core";
import "@copilotkit/react-ui/styles.css";

export default function ModelSelectorWrapper() {
  return (
      <main className="flex flex-col items-center justify-between">
        <ModelSelectorProvider>
            <Home/>
          <ModelSelector />
        </ModelSelectorProvider>
      </main>
  );
}

function Home() {
  const { useLgc } = useModelSelectorContext();

  return (
      <CopilotKit runtimeUrl={useLgc ? "/api/copilotkit-lgc" : "/api/copilotkit"} agent="ai_researcher">
        <ResearchProvider>
          <ResearchWrapper />
        </ResearchProvider>
      </CopilotKit>
  );
}
