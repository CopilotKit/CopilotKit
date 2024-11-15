"use client";

import { CopilotKit } from "@copilotkit/react-core";
import { Mailer } from "./Mailer";
import "@copilotkit/react-ui/styles.css";
import { ModelSelectorProvider, useModelSelectorContext } from "@/lib/model-selector-provider";
import { ModelSelector } from "@/components/ModelSelector";

export default function ModelSelectorWrapper() {
    return (
        <main className="flex flex-col items-center justify-between">
            <ModelSelectorProvider>
                <Home/>
                <ModelSelector/>
            </ModelSelectorProvider>
        </main>
    );
}

function Home() {
  const { useLgc } = useModelSelectorContext();

  return (
      <CopilotKit runtimeUrl={useLgc ? "/api/copilotkit-lgc" : "/api/copilotkit"} agent="email_agent">
          <Mailer />
      </CopilotKit>
  );
}
