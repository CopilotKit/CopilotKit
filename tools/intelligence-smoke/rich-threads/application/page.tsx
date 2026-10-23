"use client";
import { useSearchParams } from "next/navigation";
import {
  CopilotKit,
  CopilotChatConfigurationProvider,
} from "@copilotkit/react-core/v2";
import { HomePage } from "@/app/demos/beautiful-chat/home-page";
import { ThemeProvider } from "@/app/demos/beautiful-chat/hooks/use-theme";
import { demonstrationCatalog } from "@/app/demos/beautiful-chat/declarative-generative-ui/renderers";

/** One actual Showcase Beautiful Chat UI shared across both native backends. */
export default function RichThreadsPage() {
  const framework = useSearchParams().get("framework");
  if (!framework || !["mastra", "strands-typescript"].includes(framework))
    return <p>Unsupported framework</p>;
  return (
    <ThemeProvider>
      <CopilotKit
        runtimeUrl={`/api/rich-threads/${framework}/rich`}
        agent="beautiful-chat"
        a2ui={{ catalog: demonstrationCatalog }}
        openGenerativeUI={{}}
      >
        <CopilotChatConfigurationProvider agentId="beautiful-chat">
          <HomePage />
        </CopilotChatConfigurationProvider>
      </CopilotKit>
    </ThemeProvider>
  );
}
