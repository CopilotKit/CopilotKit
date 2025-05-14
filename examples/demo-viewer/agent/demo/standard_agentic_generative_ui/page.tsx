"use client";
import React from "react";
import "@copilotkit/react-ui/styles.css";
import "./style.css";
import { CopilotKit, useCopilotAction } from "@copilotkit/react-core";
import { CopilotChat, useCopilotChatSuggestions } from "@copilotkit/react-ui";
import { initialPrompt, chatSuggestions, instructions } from "@/lib/prompts";
import { Steps } from "./Steps";
const AgenticGenerativeUI: React.FC = () => {
  return (
    <CopilotKit
      runtimeUrl="/api/copilotkit?standard=true"
      showDevConsole
    >
      <Chat />
    </CopilotKit>
  );
};

const Chat = () => {

  useCopilotAction({
    name: "show_steps",
    description: "Show the steps to the user which was requested by the user",
    parameters: [
      {
        name: "steps",
        type: "object[]",
        attributes: [
          { name: "description", type: "string" },
          { name: "status", type: "string", enum: ["pending", "completed"] }
        ]
      }
    ],
    followUp: false,
    renderAndWaitForResponse: ({ status, args, respond }) => {
      debugger
      console.log(status, "stauts", args)
      if (status === "executing" || status === "complete") {
        return (<Steps status={status} args={args} respond={respond} />)
      }
      else {
        return <></>
      }
    },
    // handler: async ({ steps }) => {
    // for (let i = 0; i < steps.length; i++) {
    //   await delay(1000);
    // steps[i].status = "completed";
    // Optionally update agent state here for UI
    // }
    // return { steps };
    // }
  })

  useCopilotChatSuggestions({
    instructions: chatSuggestions.agenticGenerativeUI,
  })
  return (
    <div className="flex justify-center items-center h-screen w-screen">
      <div className="w-8/10 h-8/10">
        <CopilotChat
          instructions={instructions.agenticGenerativeUI}
          className="h-full rounded-lg"
          labels={{ initial: initialPrompt.agenticGenerativeUI }}
        />
      </div>
    </div>
  );
};

export function Spinner() {
  return (
    <svg
      className="mr-2 size-3 animate-spin text-slate-500"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      ></circle>
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      ></path>
    </svg>
  );
}

export default AgenticGenerativeUI;
