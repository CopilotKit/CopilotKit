"use client";

import { CopilotChat } from "@copilotkit/react-core/v2";

export default function CopilotKitPage() {
  return (
    <main className="h-screen w-screen flex justify-center items-center">
      <CopilotChat className="w-1/2 h-full" />
    </main>
  );
}
