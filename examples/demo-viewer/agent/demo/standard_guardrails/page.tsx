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
      publicApiKey={process.env.NEXT_PUBLIC_CPK_KEY}
      // publicApiKey="ck_pub_66bda706b0d8a540e96fcd9c043fe86f"
      // runtimeUrl="/api/copilotkit?standard=true"
      showDevConsole={false}
      guardrails_c={{
        // Topics to explicitly block
        invalidTopics: ["politics", "explicit-content", "harmful-content"],
        // Topics to explicitly allow
        // validTopics: ["business", "technology", "general-assistance"],
      }}
      // agent="agentic_chat"
    >
      <Chat />
    </CopilotKit>
  );
};

const Chat = () => {

  // useCopilotChatSuggestions({
  //   instructions: chatSuggestions.agenticChat,
  //   // className : "bg-gray-100"
  // })


  return (
    <div
      className="flex justify-center items-center h-full w-full"
      style={{ background: "var(--copilot-kit-background-color)" }}
    >
      <div className="w-8/10 h-8/10 rounded-lg ">
        <CopilotChat
          className="h-full w-full rounded-2xl py-6"
          // labels={{ initial: initialPrompt.agenticChat }}
        />
      </div>
    </div>
  );
};

export default AgenticChat;
