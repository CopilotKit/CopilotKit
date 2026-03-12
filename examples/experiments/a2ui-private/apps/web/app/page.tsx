"use client";

import { CopilotChat, CopilotKitProvider } from "@copilotkit/react-core/v2";
import { createA2UIMessageRenderer } from "@copilotkitnext/a2ui-renderer";
import { theme } from "./theme";

// Disable static optimization for this page
export const dynamic = "force-dynamic";

const A2UIMessageRenderer = createA2UIMessageRenderer({ theme });

export default function Home() {
  return (
    <CopilotKitProvider
      runtimeUrl="/api/copilotkit"
      showDevConsole="auto"
      renderActivityMessages={[A2UIMessageRenderer]}
    >
      <main
        className="flex min-h-screen flex-1 flex-col overflow-hidden"
        style={{ minHeight: "100dvh" }}
      >
        <Chat />
      </main>
    </CopilotKitProvider>
  );
}

function Chat() {
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <CopilotChat style={{ flex: 1, minHeight: "100%" }} />
    </div>
  );
}
