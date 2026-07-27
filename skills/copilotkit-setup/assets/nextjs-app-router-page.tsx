// File: src/app/page.tsx
// Next.js App Router frontend with CopilotKit provider and chat UI
//
// Prerequisites:
//   npm install @copilotkit/react-core
//
// Also add to layout.tsx:
//   import "@copilotkit/react-core/v2/styles.css";

"use client";

import { CopilotKit, CopilotChat } from "@copilotkit/react-core/v2";

export default function Home() {
  return (
    // useSingleEndpoint={false} pairs with the multi-route runtime handler.
    // The v1-compat CopilotKit bridge defaults this to true (single-route
    // transport), which would 404 against the multi-route backend — keep it.
    <CopilotKit runtimeUrl="/api/copilotkit" useSingleEndpoint={false}>
      <div
        style={{ height: "100vh", margin: 0, padding: 0, overflow: "hidden" }}
      >
        <CopilotChat />
      </div>
    </CopilotKit>
  );
}
