"use client";
import "@copilotkit/react-ui/styles.css";
import { CopilotKit, useCopilotAction } from "@copilotkit/react-core";
import { CopilotChat } from "@copilotkit/react-ui";
import React, { useState } from "react";

// registry/registry/quickstarts/coagents-starter-crewai-flows/page.tsx

// Keep only the env-var reads at module scope
const publicApiKey = process.env.NEXT_PUBLIC_COPILOT_API_KEY;
const agentName = process.env.NEXT_PUBLIC_COPILOTKIT_AGENT_NAME;

const CrewAIFlow: React.FC = () => {
  // Move the missing-env check into the component render
  if (!publicApiKey || !agentName) {
    return (
      <div className="h-screen w-full flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-xl font-bold mb-2">Configuration Error</h2>
          <p>
            Missing required environment variables: NEXT_PUBLIC_COPILOT_API_KEY
            and NEXT_PUBLIC_COPILOTKIT_AGENT_NAME
          </p>
        </div>
      </div>
    );
  }

  return (
    <CopilotKit publicApiKey={publicApiKey} agent={agentName}>
      <Chat />
    </CopilotKit>
  );
};

export default CrewAIFlow;

// Main Chat Component: Handles chat interface and background customization
const Chat = () => {
  const [background, setBackground] = useState(
    "linear-gradient(135deg, #667eea 0%, #764ba2 100%)"
  );

  // Action: Allow AI to change background color dynamically
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

  return (
    <div
      className="h-screen w-full flex items-center justify-center"
      style={{ background }}
    >
      <div className="w-full max-w-3xl h-[80vh] px-4">
        <div className="h-full bg-white/10 backdrop-blur-lg rounded-2xl shadow-2xl overflow-hidden">
          <CopilotChat
            className="h-full"
            labels={{
              initial: "Hi, I'm an agent. Want to chat?",
              placeholder: "Type a message...",
            }}
          />
        </div>
      </div>
    </div>
  );
};
