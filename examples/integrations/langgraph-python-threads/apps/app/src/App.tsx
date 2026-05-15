import { useState } from "react";
import {
  CopilotChat,
  CopilotChatConfigurationProvider,
  CopilotKit,
  CopilotKitProvider,
} from "@copilotkit/react-core/v2";
import { ExampleLayout } from "@/components/example-layout";
import { ExampleCanvas } from "@/components/example-canvas";
import { ThreadsDrawer } from "@/components/threads-drawer";
import { ThemeProvider } from "@/hooks/use-theme";
import { useExampleSuggestions, useGenerativeUIExamples } from "@/hooks";
import { demonstrationCatalog } from "@/declarative-generative-ui/renderers";
import styles from "@/components/threads-drawer/threads-drawer.module.css";

const runtimeUrl = "/api/copilotkit";

function HomePage() {
  useGenerativeUIExamples();
  useExampleSuggestions();

  const [threadId, setThreadId] = useState<string | undefined>(undefined);

  return (
    <div className={styles.layout}>
      <ThreadsDrawer
        agentId="default"
        threadId={threadId}
        onThreadChange={setThreadId}
      />
      <div className={styles.mainPanel}>
        {/*
          Wrap both the chat and the canvas in one CopilotChatConfigurationProvider
          so they share the active threadId. `useAgent()` falls back to the
          provider's threadId when called without an explicit one, which makes
          the canvas read from the same per-thread agent clone that the chat's
          /connect replay populates. Without this wrapper, the canvas resolves
          to the registry agent and never receives STATE_SNAPSHOT events on
          thread resume.
        */}
        <CopilotChatConfigurationProvider agentId="default" threadId={threadId}>
          <ExampleLayout
            chatContent={
              <CopilotChat
                input={{ disclaimer: () => null, className: "pb-6" }}
              />
            }
            appContent={<ExampleCanvas />}
          />
        </CopilotChatConfigurationProvider>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <CopilotKit
        runtimeUrl={runtimeUrl}
        a2ui={{ catalog: demonstrationCatalog }}
        openGenerativeUI={{}}
        useSingleEndpoint={false}
      >
        <HomePage />
      </CopilotKit>
    </ThemeProvider>
  );
}
