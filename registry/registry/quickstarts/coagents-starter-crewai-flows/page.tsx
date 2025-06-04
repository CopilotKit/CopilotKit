"use client";
import "@copilotkit/react-ui/styles.css";
import { CopilotKit, useCopilotAction } from "@copilotkit/react-core";
import { CopilotChat } from "@copilotkit/react-ui";
import React, { useState } from "react";

const publicApiKey = process.env.NEXT_PUBLIC_COPILOT_API_KEY || "";
/**
 * AgentName refers to the Crew Flow Agent you have saved via CLI during setup.
 * It is used to identify the agent you want to use for the chat.
 */
const agentName =
  process.env.NEXT_PUBLIC_COPILOTKIT_AGENT_NAME || "DefaultAgent";

// Main Chat Component: Handles chat interface and background customization
const Chat = () => {
  const [background, setBackground] = useState(
    "--copilot-kit-background-color"
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
      className="flex justify-center items-center h-full w-full"
      style={{ background }}
    >
      <div className="w-8/10 h-8/10 rounded-lg">
        <CopilotChat
          className="h-full rounded-2xl"
          labels={{ initial: "Hi, I'm an agent. Want to chat?" }}
        />
      </div>
    </div>
  );
};

// App Component: Main wrapper that provides CopilotKit context
const CrewAIFlow: React.FC = () => (
  <CopilotKit publicApiKey={publicApiKey} agent={agentName}>
    <Chat />
  </CopilotKit>
);

export default CrewAIFlow;
