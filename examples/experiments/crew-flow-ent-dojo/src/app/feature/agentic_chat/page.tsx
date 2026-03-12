"use client";
import { CustomAssistantMessage } from "@/components/ui/custom-assistant-message";
import { CopilotKit, useCopilotAction } from "@copilotkit/react-core";
import { CopilotChat } from "@copilotkit/react-ui";
import "@copilotkit/react-ui/styles.css";
import React, { useEffect, useState } from "react";
import "./style.css";

const Chat = () => {
  const [background, setBackground] = useState(
    "--copilot-kit-background-color"
  );
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);

  useCopilotAction({
    name: "change_background",
    description:
      "Change the background color of the chat. Can be anything that the CSS background attribute accepts. Regular colors, linear of radial gradients etc.",
    parameters: [
      {
        name: "background",
        type: "string",
        description: "The background. Prefer gradients.",
      },
    ],
    handler: ({ background }) => setBackground(background),
    followUp: false,
  });

  if (!isClient) return null;

  return (
    <div
      className="flex justify-center items-center h-full w-full"
      style={{ background }}
    >
      <div className="w-8/10 h-8/10 rounded-lg">
        <CopilotChat
          className="h-full rounded-2xl"
          labels={{ initial: "Hi, I'm an agent. Want to chat?" }}
          AssistantMessage={CustomAssistantMessage}
        />
      </div>
    </div>
  );
};

const AgenticChat: React.FC = () => (
  <CopilotKit agent="agentic_chat" runtimeUrl="/api/copilotkit">
    <Chat />
  </CopilotKit>
);

export default AgenticChat;
