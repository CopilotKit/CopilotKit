"use client";

import { CopilotKit } from "@copilotkit/react-core";
import { Greeter } from "./Greeter";
import "@copilotkit/react-ui/styles.css";

export default function Home() {
  return (
    <main className="flex flex-col items-center justify-between">
      <CopilotKit runtimeUrl="/api/copilotkit">
        <Greeter />
      </CopilotKit>
    </main>
  );
}
