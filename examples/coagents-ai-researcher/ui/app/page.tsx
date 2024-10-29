"use client";

import { ModelSelector } from "@/components/ModelSelector";
import { ResearchWrapper } from "@/components/ResearchWrapper";
import { ModelSelectorProvider } from "@/lib/model-selector-provider";
import { ResearchProvider } from "@/lib/research-provider";
import { CopilotKit } from "@copilotkit/react-core";
import "@copilotkit/react-ui/styles.css";

export default function Home() {
  return (
    <main className="flex flex-col items-center justify-between">
      <ModelSelectorProvider>
        <CopilotKit runtimeUrl="/api/copilotkit" agent="search_agent">
          <ResearchProvider>
            <ResearchWrapper />
          </ResearchProvider>
        </CopilotKit>
        <ModelSelector />
      </ModelSelectorProvider>
    </main>
  );
}
