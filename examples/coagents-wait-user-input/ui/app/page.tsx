"use client";

import { CopilotKit } from "@copilotkit/react-core";
import { WaitForUserInput } from "./WaitForUserInput";
import "@copilotkit/react-ui/styles.css";

export default function Home() {
  return (
    <main className="flex flex-col items-center justify-between">
      <CopilotKit runtimeUrl="/api/copilotkit" agent="weather_agent">
        <WaitForUserInput />
      </CopilotKit>
    </main>
  );
}
