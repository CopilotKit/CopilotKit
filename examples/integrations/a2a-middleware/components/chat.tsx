"use client";

/**
 * Chat Component - Main interface with A2A message visualization.
 * Extracts structured data from agents and passes to parent for display.
 */

import React, { useEffect } from "react";
import { CopilotKit, useCopilotChat, useCopilotAction } from "@copilotkit/react-core";
import { CopilotChat } from "@copilotkit/react-ui";
import "@copilotkit/react-ui/styles.css";
import { MessageToA2A } from "./a2a/MessageToA2A";
import { MessageFromA2A } from "./a2a/MessageFromA2A";

type ResearchData = {
  topic: string;
  summary: string;
  findings: Array<{ title: string; description: string }>;
  sources: string;
};

type AnalysisData = {
  topic: string;
  overview: string;
  insights: Array<{ title: string; description: string; importance: string }>;
  conclusion: string;
};

type ChatProps = {
  onResearchUpdate: (data: ResearchData | null) => void;
  onAnalysisUpdate: (data: AnalysisData | null) => void;
};

const ChatInner = ({ onResearchUpdate, onAnalysisUpdate }: ChatProps) => {
  const { visibleMessages } = useCopilotChat();

  // Extract structured JSON from A2A agent responses and pass to parent
  useEffect(() => {
    const extractDataFromMessages = () => {
      for (const message of visibleMessages) {
        const msg = message as any;

        if (msg.type === "ResultMessage" && msg.actionName === "send_message_to_a2a_agent") {
          try {
            const result = msg.result;
            let parsed;

            if (typeof result === "string") {
              let cleanResult = result;
              if (result.startsWith("A2A Agent Response: ")) {
                cleanResult = result.substring("A2A Agent Response: ".length);
              }
              try {
                parsed = JSON.parse(cleanResult);
              } catch {
                continue;
              }
            } else if (typeof result === "object") {
              parsed = result;
            } else {
              continue;
            }

            if (parsed.findings && Array.isArray(parsed.findings)) {
              onResearchUpdate(parsed as ResearchData);
            } else if (parsed.insights && Array.isArray(parsed.insights)) {
              onAnalysisUpdate(parsed as AnalysisData);
            }
          } catch (e) {
            console.error("Failed to extract data from message:", e);
          }
        }
      }
    };

    extractDataFromMessages();
  }, [visibleMessages, onResearchUpdate, onAnalysisUpdate]);

  // Register action to render A2A message flow visualization
  useCopilotAction({
    name: "send_message_to_a2a_agent",
    description: "Sends a message to an A2A agent",
    available: "frontend",
    parameters: [
      {
        name: "agentName",
        type: "string",
        description: "The name of the A2A agent to send the message to",
      },
      {
        name: "task",
        type: "string",
        description: "The message to send to the A2A agent",
      },
    ],
    render: (actionRenderProps) => {
      return (
        <>
          <MessageToA2A {...actionRenderProps} />
          <MessageFromA2A {...actionRenderProps} />
        </>
      );
    },
  });

  return (
    <CopilotChat
      labels={{
        title: "Research Assistant",
        initial: "👋 Hi! I'm your research assistant. I can help you research any topic.\n\nFor example, try:\n- \"Research quantum computing\"\n- \"Tell me about artificial intelligence\"\n- \"Research renewable energy\"\n\nI'll coordinate with specialized agents to gather information and provide insights!",
      }}
      className="h-full"
    />
  );
};

export default function Chat({ onResearchUpdate, onAnalysisUpdate }: ChatProps) {
  return (
    <CopilotKit
      runtimeUrl="/api/copilotkit"
      agent="a2a_chat"
    >
      <ChatInner
        onResearchUpdate={onResearchUpdate}
        onAnalysisUpdate={onAnalysisUpdate}
      />
    </CopilotKit>
  );
}
