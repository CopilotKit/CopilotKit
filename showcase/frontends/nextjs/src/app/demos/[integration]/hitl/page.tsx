"use client";

import {
  CopilotChat,
  CopilotKit,
  useHumanInTheLoop,
  useInterrupt,
} from "@copilotkit/react-core/v2";
import { z } from "zod";
import { useDemoRuntimeUrl } from "@/lib/demo-runtime";
import { StepSelector } from "./step-selector";
import { StepsFeedback } from "./steps-feedback";
import { useHitlSuggestions } from "./suggestions";

export default function HitlDemo() {
  return (
    <CopilotKit
      runtimeUrl={useDemoRuntimeUrl("hitl")}
      agent="human_in_the_loop"
    >
      <DemoContent />
    </CopilotKit>
  );
}

function DemoContent() {
  useHitlSuggestions();

  // An agent that pauses with an interrupt sends the proposed steps in the
  // interrupt value. Agents that never interrupt leave this hook idle.
  useInterrupt({
    render: ({ event, resolve }) => (
      <StepSelector
        steps={event.value?.steps || []}
        onConfirm={(selectedSteps) => {
          void resolve(
            "The user selected the following steps: " +
              selectedSteps.map((s) => s.description).join(", "),
          );
        }}
      />
    ),
  });

  // An agent that calls the `generate_task_steps` frontend tool gets the
  // user's answer back as the tool result.
  useHumanInTheLoop({
    agentId: "human_in_the_loop",
    name: "generate_task_steps",
    description: "Generates a list of steps for the user to perform",
    parameters: z.object({
      steps: z.array(
        z.object({
          description: z.string(),
          status: z.enum(["enabled", "disabled", "executing"]),
        }),
      ),
    }),
    render: ({ args, respond, status }) => (
      <StepsFeedback args={args} respond={respond} status={status} />
    ),
  });

  return (
    <div className="flex justify-center items-center h-screen w-full">
      <div className="h-full w-full max-w-4xl">
        <CopilotChat
          agentId="human_in_the_loop"
          className="h-full rounded-2xl"
        />
      </div>
    </div>
  );
}
