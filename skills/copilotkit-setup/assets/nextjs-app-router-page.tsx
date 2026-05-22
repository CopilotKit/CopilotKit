// File: src/app/page.tsx
// Next.js App Router frontend with CopilotKit provider and chat UI
//
// Prerequisites:
//   npm install @copilotkit/react @copilotkit/core
//
// Also add to layout.tsx:
//   import "@copilotkit/react/styles.css";

"use client";

import { CopilotKitProvider, CopilotChat } from "@copilotkit/react";

export default function Home() {
  return (
    <CopilotKitProvider runtimeUrl="/api/copilotkit" showDevConsole="auto">
      <div style={{ height: "100vh", margin: 0, padding: 0, overflow: "hidden" }}>
        <CopilotChat />
      </div>
    </CopilotKitProvider>
  );
}
