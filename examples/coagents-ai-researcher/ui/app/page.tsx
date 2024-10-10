
import { ResearchWrapper } from "@/components/ResearchWrapper";
import { ResearchProvider } from "@/lib/research-provider";
import { CopilotKit } from "@copilotkit/react-core";
import "@copilotkit/react-ui/styles.css";

export default function Home() {
  const RUNTIME_URL = process.env.RUNTIME_URL || "/api/copilotkit"
  const COPILOT_CLOUD_PUBLIC_API_KEY = process.env.COPILOT_CLOUD_PUBLIC_API_KEY;

  return (
    <main className="flex flex-col items-center justify-between">
      <CopilotKit
        runtimeUrl={RUNTIME_URL}
        publicApiKey={COPILOT_CLOUD_PUBLIC_API_KEY}
        agent="search_agent"
      >
        <ResearchProvider>
          <ResearchWrapper />
        </ResearchProvider>
      </CopilotKit>
    </main>
  );
}

