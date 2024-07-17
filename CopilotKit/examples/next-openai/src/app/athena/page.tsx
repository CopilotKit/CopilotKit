"use client";
import { CopilotKit, useCopilotChat, useCopilotReadable } from "@copilotkit/react-core";
import { CopilotKitCSSProperties, CopilotPopup, CopilotSidebar } from "@copilotkit/react-ui";

import { useState } from "react";
import { TextMessage, Role } from "@copilotkit/runtime-client-gql";

export default function AthenaBugReproduce() {
  return (
    <CopilotKit
      runtimeUrl="/api/copilotkit"
      transcribeAudioUrl="/api/transcribe"
      textToSpeechUrl="/api/tts"
    >
      <div
        style={
          {
            height: `100vh`,
            "--copilot-kit-primary-color": "#222222",
          } as CopilotKitCSSProperties
        }
      >
        <CopilotSidebar
          instructions={"Help the user write short poems."}
          defaultOpen={true}
          labels={{
            title: "Presentation Copilot",
            initial: "Testing appendMessage",
          }}
          clickOutsideToClose={false}
        >
          <Test />
        </CopilotSidebar>
      </div>
    </CopilotKit>
  );
}

function Test() {
  const { appendMessage } = useCopilotChat();
  const topics = ["moon", "love", "war", "death", "life"];
  const [currentTopic, setCurrentTopic] = useState<string>(topics[0]);
  useCopilotReadable({
    description: "The current topic",
    value: currentTopic,
  });

  return (
    <>
      <button
        style={{ color: "white", backgroundColor: "gray", margin: "50px", padding: "10px" }}
        onClick={async () => {
          appendMessage(
            new TextMessage({
              content:
                "Hello give me a short poem about the current topic. Prefix the demo with the current topic in bold.",
              role: Role.User,
            }),
          );
          // switch topic to simulate new copilotReadable context
          setCurrentTopic(topics[Math.floor(Math.random() * topics.length)]);
        }}
      >
        Simulate new input
      </button>
    </>
  );
}
