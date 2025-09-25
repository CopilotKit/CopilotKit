"use client";

import { Inter } from "next/font/google";
import { CopilotKit } from "@copilotkit/react-core";
import { CopilotSidebar } from "@copilotkit/react-ui";

const _inter = Inter({ subsets: ["latin"] });

export default function Home() {
  return (
    <CopilotKit
      runtimeUrl="/api/copilotkit"
      transcribeAudioUrl="/api/transcribe"
      textToSpeechUrl="/api/tts"
    >
      <CopilotSidebar
        instructions={"Be friendly and helpful to the user."}
        defaultOpen={true}
        labels={{
          title: "Copilot",
          initial: "Hi you! 👋 I can help you with anything.",
        }}
        clickOutsideToClose={false}
      >
        <div>
          <h1>Hello</h1>
        </div>
      </CopilotSidebar>
    </CopilotKit>
  );
}
