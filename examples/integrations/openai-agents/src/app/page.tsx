"use client";

import { CopilotSidebar } from "@copilotkit/react-core/v2";

export const dynamic = "force-dynamic";

export default function CopilotKitPage() {
  return (
    <main style={{ height: "100vh" }}>
      <CopilotSidebar
        defaultOpen
        labels={{
          title: "OpenAI Agents Assistant",
          initial: "Hi! I run on the OpenAI Agents SDK. Ask me anything.",
        }}
      />
    </main>
  );
}
