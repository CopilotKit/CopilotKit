"use client";

import { CopilotKit } from "@copilotkit/react-core";
import ResearchCanvas from "./ResearchCanvas";

export default function Home() {
  return (
    <CopilotKit
      runtimeUrl="/api/copilotkit"
      showDevConsole={false}
      agent="research_agent"
    >
      <ResearchCanvas />
    </CopilotKit>
  );
}
