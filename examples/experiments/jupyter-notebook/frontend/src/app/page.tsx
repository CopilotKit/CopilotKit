"use client";

import { CopilotKitProvider, CopilotChat } from "@copilotkit/react-core/v2";
import "@copilotkit/react-core/v2/styles.css";

export const dynamic = "force-dynamic";

export default function Home() {
  return (
    <CopilotKitProvider runtimeUrl="/api/copilotkit">
      <div className="h-screen w-screen">
        <CopilotChat />
      </div>
    </CopilotKitProvider>
  );
}
