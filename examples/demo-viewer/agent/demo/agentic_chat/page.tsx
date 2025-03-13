"use client";
import React, { useState } from "react";
import "@copilotkit/react-ui/styles.css";
import "./style.css";
import { CopilotKit, useCopilotAction } from "@copilotkit/react-core";
import { CopilotChat } from "@copilotkit/react-ui";

const AgenticChat: React.FC = () => {
  return (
    <CopilotKit
      runtimeUrl="/api/copilotkit"
      showDevConsole={false}
      agent="agentic_chat"
    >
      <Chat />
    </CopilotKit>
  );
};

const Chat = () => {
  const [background, setBackground] = useState<string>("#fefefe");

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
    handler: ({ background }) => {
      console.log("background", background);
      setBackground(background);
    },
  });

  return (
    <div
      className="flex justify-center items-center h-full w-full"
      style={{ background }}
    >
      <div className="w-8/10 h-8/10">
        <CopilotChat
          className="h-full rounded-lg"
          labels={{ initial: "Hi, I'm an agent. Want to chat?" }}
        />
      </div>
    </div>
  );
};

export default AgenticChat;
