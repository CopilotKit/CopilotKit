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
  const { lgcDeploymentUrl } = useModelSelectorContext();

  return (
      <CopilotKit runtimeUrl={`/api/copilotkit?lgcDeploymentUrl=${lgcDeploymentUrl ?? ''}`} agent="email_agent">
          <Mailer />
      </CopilotKit>
  );
}
