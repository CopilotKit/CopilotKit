"use client";

import { CopilotChat, CopilotKitProvider } from "@copilotkit/react-core/v2";
import { playgroundTheme, playgroundUI } from "@/a2ui/catalog/catalog";

const GENERATIVE_UI = { ui: playgroundUI, theme: playgroundTheme };

export default function MinimalPage() {
  return (
    <CopilotKitProvider
      runtimeUrl="/api/minimal"
      generativeUI={GENERATIVE_UI}
      enableInspector={false}
    >
      <main className="mx-auto h-[100dvh] max-w-3xl">
        <CopilotChat agentId="default" />
      </main>
    </CopilotKitProvider>
  );
}
