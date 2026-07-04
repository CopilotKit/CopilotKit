"use client";

// @region[hitl-hook]
import React from "react";
import {
  CopilotKit,
  CopilotChat,
  useAgentContext,
  useHumanInTheLoop,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";
import { z } from "zod";
import { StepsFeedback } from "./steps-feedback";

export default function HitlDemo() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit" agent="hitl">
      <div className="flex justify-center items-center h-screen w-full">
        <div className="h-full w-full max-w-4xl">
          <Chat />
        </div>
      </div>
    </CopilotKit>
  );
}

function Chat() {
  // @region[agent-steering]
  // Per-demo steering via AG-UI context (clawg-ui appends it to the agent
  // prompt). Keeps the "call generate_task_steps" instruction with this demo.
  useAgentContext({
    description: "Operating instructions for this demo",
    value:
      "You are a planning assistant. Whenever the user asks you to plan or " +
      "break down a task, you MUST call the generate_task_steps tool with an " +
      "ordered list of concrete steps (each with a description and status). " +
      "The user reviews and edits the steps, then confirms or rejects. When " +
      "the tool returns their decision, acknowledge it concisely.",
  });
  // @endregion[agent-steering]

  useConfigureSuggestions({
    suggestions: [
      {
        title: "Simple plan",
        message: "Please plan a trip to Mars in 5 steps.",
      },
      {
        title: "Complex plan",
        message: "Please plan a pasta dish in 10 steps.",
      },
    ],
    available: "always",
  });

  useHumanInTheLoop({
    agentId: "hitl",
    name: "generate_task_steps",
    description:
      "Propose a list of steps for the user to review. The user enables/disables steps and confirms or rejects; their decision is returned to the agent.",
    parameters: z.object({
      steps: z
        .array(
          z.object({
            description: z.string().describe("What this step does"),
            status: z
              .enum(["enabled", "disabled", "executing"])
              .describe("Whether the step is selected"),
          }),
        )
        .describe("The ordered list of proposed steps"),
    }),
    render: ({ args, respond, status }: any) => (
      <StepsFeedback args={args} respond={respond} status={status} />
    ),
  });
  // @endregion[hitl-hook]

  return <CopilotChat agentId="hitl" className="h-full rounded-2xl" />;
}
