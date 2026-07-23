"use client";

/**
 * Chat Component - Main interface with A2A message visualization.
 * Extracts structured data from agents and passes to parent for display.
 */

import React, { useEffect } from "react";
import {
  useAgent,
  useFrontendTool,
  CopilotChat,
} from "@copilotkit/react-core/v2";
import { z } from "zod";
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

export default function Chat({
  onResearchUpdate,
  onAnalysisUpdate,
}: ChatProps) {
  const { agent } = useAgent({ agentId: "a2a_chat" });

  // Extract structured JSON from A2A agent responses and pass to parent
  useEffect(() => {
    const extractDataFromMessages = () => {
      for (const message of agent.messages) {
        const msg = message as any;

        if (msg.role === "tool" && typeof msg.content !== "undefined") {
          try {
            const result = msg.content;
            let parsed;

            if (typeof result === "string") {
              let cleanResult = result;
              if (result.startsWith("A2A Agent Response: ")) {
                cleanResult = result.slice("A2A Agent Response: ".length);
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
  }, [agent.messages, onResearchUpdate, onAnalysisUpdate]);

  // Register action to render A2A message flow visualization
  useFrontendTool({
    name: "send_message_to_a2a_agent",
    description: "Sends a message to an A2A agent",
    available: true,
    parameters: z.object({
      agentName: z
        .string()
        .describe("The name of the A2A agent to send the message to"),
      task: z.string().describe("The message to send to the A2A agent"),
    }),
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
        modalHeaderTitle: "Research Assistant",
        welcomeMessageText:
          '👋 Hi! I\'m your research assistant. I can help you research any topic.\n\nFor example, try:\n- "Research quantum computing"\n- "Tell me about artificial intelligence"\n- "Research renewable energy"\n\nI\'ll coordinate with specialized agents to gather information and provide insights!',
      }}
      className="h-full"
    />
  );
}
