"use client";
import React, { useState } from "react";
import "@copilotkit/react-ui/styles.css";
import "./style.css";
import { CopilotKit, useFrontendTool } from "@copilotkit/react-core";
import { z } from "zod";
import { CopilotChat, useCopilotChatSuggestions } from "@copilotkit/react-ui";
import { chatSuggestions, initialPrompt } from "@/lib/prompts";
import { AGENT_TYPE } from "@/config";
const AgenticChat: React.FC = () => {
  return (
    <CopilotKit
    runtimeUrl={AGENT_TYPE == "general" ? "/api/copilotkit?langgraph=true" : "/api/copilotkit"}
    showDevConsole={false}
      agent="agentic_chat"
    >
      <Chat />
    </CopilotKit>
  );
};

const Chat = () => {
  const [background, setBackground] = useState<string>("#fefefe");

  useFrontendTool({
    name: "change_background",
    description:
      "Change the background color of the chat. Can be anything that the CSS background attribute accepts. Regular colors, linear of radial gradients etc.",
    parameters: z.object({
      background: z.string().describe("The background. Prefer gradients."),
    }),
    handler: ({ background }) => {
      setBackground(background);
    },
  });

  useCopilotChatSuggestions({
    instructions: chatSuggestions.agenticChat,
  })

  return (
    <div
      className="flex justify-center items-center h-full w-full"
      style={{ background }}
    >
      <div className="w-8/10 h-8/10 rounded-lg">
        <CopilotChat
          className="h-full w-full rounded-lg py-6"
          labels={{ initial: initialPrompt.agenticChat }}
        />
      </div>
    </div>
  );
};

export default AgenticChat;
