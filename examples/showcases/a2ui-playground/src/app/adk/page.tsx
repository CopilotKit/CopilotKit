"use client";

import { CopilotChat, CopilotKitProvider } from "@copilotkit/react-core/v2";
import { playgroundTheme, playgroundUI } from "@/a2ui/catalog/catalog";

const GENERATIVE_UI = { ui: playgroundUI, theme: playgroundTheme };

/** The same catalog as /minimal, answered by the Google ADK agent in examples/adk (via /api/adk). */
export default function AdkPage() {
  return (
    <CopilotKitProvider
      runtimeUrl="/api/adk"
      generativeUI={GENERATIVE_UI}
      enableInspector={false}
    >
      <main className="mx-auto h-[100dvh] max-w-3xl">
        <CopilotChat agentId="default" />
      </main>
    </CopilotKitProvider>
  );
}
