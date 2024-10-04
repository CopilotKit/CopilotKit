"use client";

import { CopilotPopup } from "@copilotkit/react-ui";

export function Greeter() {
  return (
    <div className="flex flex-col items-center justify-center h-screen">
      <div className="text-2xl">Text Q&A example</div>
      <div>ask: "Greet me!"</div>

      <CopilotPopup defaultOpen={true} clickOutsideToClose={false} />
    </div>
  );
}
