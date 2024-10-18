"use client";

import { CopilotKit } from "@copilotkit/react-core";
import { CopilotKitCSSProperties, CopilotSidebar } from "@copilotkit/react-ui";
import "./styles.css";
import { Presentation } from "./components/main/Presentation";
import { useState } from "react";
import { useSearchParams } from "next/navigation";

export default function AIPresentation() {
  const [performResearch, setPerformResearch] = useState(false);
  const searchParams = useSearchParams();
  const serviceAdapter = searchParams.get("serviceAdapter") || "openai";
  const runtimeUrl =
    process.env["NEXT_PUBLIC_COPILOTKIT_RUNTIME_URL"] ??
    `/api/copilotkit/presentation?serviceAdapter=${serviceAdapter}`;

  const copilotKitProps = {
    transcribeAudioUrl: "/api/transcribe",
    textToSpeechUrl: "/api/tts",
    runtimeUrl,
    publicApiKey: process.env["NEXT_PUBLIC_COPILOTKIT_PUBLIC_API_KEY"] ?? undefined,
  };

  return (
    <CopilotKit {...copilotKitProps}>
      <div
        style={
          {
            height: `100vh`,
            "--copilot-kit-primary-color": "#222222",
          } as CopilotKitCSSProperties
        }
      >
        <CopilotSidebar
          instructions={
            "Help the user create and edit a powerpoint-style presentation." +
            (!performResearch
              ? " No research is needed. Do not perform any research."
              : " Perform research on the topic.")
          }
          defaultOpen={true}
          labels={{
            title: "Presentation Copilot",
            initial: "Hi you! 👋 I can help you create a presentation on any topic.",
          }}
          clickOutsideToClose={false}
        >
          <div className="relative">
            <Presentation
              performResearch={performResearch}
              setPerformResearch={setPerformResearch}
            />
          </div>
        </CopilotSidebar>
      </div>
    </CopilotKit>
  );
}
