"use client";

import { CopilotKit } from "@copilotkit/react-core";
import { Greeter } from "./Greeter";
import "@copilotkit/react-ui/styles.css";
import { ModelSelectorProvider } from "@/lib/model-selector-provider";
import { ModelSelector } from "@/components/ModelSelector";

export default function Home() {
  return (
    <main className="flex flex-col items-center justify-between">
      <ModelSelectorProvider>
        <CopilotKit runtimeUrl="/api/copilotkit">
          <Greeter />
        </CopilotKit>
        <ModelSelector />
      </ModelSelectorProvider>
    </main>
  );
}
