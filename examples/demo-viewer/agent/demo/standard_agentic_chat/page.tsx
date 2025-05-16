"use client";
import React, { useState } from "react";
import "@copilotkit/react-ui/styles.css";
import "./style.css";
import { CopilotKit, useCopilotAction, useCopilotChat } from "@copilotkit/react-core";
import { CopilotChat, useCopilotChatSuggestions } from "@copilotkit/react-ui";
import { chatSuggestions, initialPrompt } from "@/lib/prompts";
const AgenticChat: React.FC = () => {
  return (
    <CopilotKit
      runtimeUrl="/api/copilotkit?standard=true"
      showDevConsole={false}
      // agent="agentic_chat"
    >
      <Chat />
    </CopilotKit>
  );
};

const Chat = () => {
  const [background, setBackground] = useState<string>("--copilot-kit-background-color");

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

  useCopilotChatSuggestions({
    instructions: chatSuggestions.agenticChat,
    // className : "bg-gray-100"
  })


  return (
    <div
      className="flex justify-center items-center h-full w-full"
      style={{ background }}
    >
      <div className="w-8/10 h-8/10 rounded-lg ">
        <CopilotChat
          className="h-full w-full rounded-2xl py-6"
          labels={{ initial: initialPrompt.agenticChat }}
        />
      </div>
    </div>
  );
};

export default AgenticChat;
