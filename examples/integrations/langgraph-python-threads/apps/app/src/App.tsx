import { useState } from "react";
import { CopilotKitProvider } from "@copilotkit/react-core/v2";
import { CopilotChat } from "@copilotkit/react-core/v2";
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
        <ExampleLayout
          chatContent={
            <CopilotChat
              agentId="default"
              threadId={threadId}
              input={{ disclaimer: () => null, className: "pb-6" }}
            />
          }
          appContent={<ExampleCanvas />}
        />
      </div>
    </div>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <CopilotKitProvider
        runtimeUrl={runtimeUrl}
        a2ui={{ catalog: demonstrationCatalog }}
        openGenerativeUI={{}}
        useSingleEndpoint={false}
      >
        <HomePage />
      </CopilotKitProvider>
    </ThemeProvider>
  );
}
