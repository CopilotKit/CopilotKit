"use client";

import { ResearchWrapper } from "@/components/ResearchWrapper";
import { ResearchProvider } from "@/lib/research-provider";
import { CopilotKit } from "@copilotkit/react-core";
import "@copilotkit/react-ui/styles.css";

export default function Home() {
  return (
    <main className="flex flex-col items-center justify-between">
      <CopilotKit
        runtimeUrl="/api/copilotkit"
        agent="search_agent"
      >
        <ResearchProvider>
          <ResearchWrapper />
        </ResearchProvider>
      </CopilotKit>
    </main>
  );
}

