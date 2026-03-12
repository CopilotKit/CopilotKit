"use client";
import { useTodo } from "@/contexts/TodoContext";
import { CopilotChat } from "@copilotkit/react-ui";
import "@copilotkit/react-ui/styles.css";
import { Loader2, RotateCw, SendIcon, Square } from "lucide-react";
import { FC } from "react";
import { Loader } from "./Loader";

export const ChatWindow: FC = () => {
  const { todos } = useTodo();
  return (
    <CopilotChat
      className="h-full flex flex-col"
      instructions={`Always use the MCP server to complete the task. You will be provided with a list of MCP servers. Use the appropriate MCP server to complete the task.
      To perform any actions over the todo task use the following data for manipulation ${JSON.stringify(
        todos
      )}`}
      labels={{
        title: "To-do Assistant",
        initial:
          "Hi! I'm your AI task assistant, powered by MCP servers that you can configure to help manage and break down your tasks. \n\nHow can I help you today?",
        placeholder: "Type your message here...",
        regenerateResponse: "Try another response",
      }}
      icons={{
        sendIcon: (
          <SendIcon className="w-4 h-4 hover:scale-110 transition-transform" />
        ),
        activityIcon: (
          <Loader
            texts={[
              "Thinking...",
              "Analyzing Your Query...",
              "Taking Action...",
            ]}
          />
        ),
        spinnerIcon: <Loader2 className="w-4 h-4 animate-spin" />,
        stopIcon: (
          <Square className="w-4 h-4 hover:text-red-500 transition-colors" />
        ),
        regenerateIcon: (
          <RotateCw className="w-4 h-4 hover:rotate-180 transition-transform duration-300" />
        ),
      }}
    />
  );
};
