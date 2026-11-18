"use client";

import {
  CopilotChat,
  CopilotKitProvider,
  useHumanInTheLoop,
  useInterrupt,
} from "@copilotkit/react-core";
import { z } from "zod";
import { useHitlSuggestions } from "./suggestions";
import { StepSelector } from "./step-selector";
import { StepsFeedback } from "./steps-feedback";

export default function HitlDemo() {
  return (
    <CopilotKitProvider
      runtimeUrl="/api/copilotkit"
      agentId="human_in_the_loop"
    >
      <DemoContent />
    </CopilotKitProvider>
  );
}

function DemoContent() {
  useHitlSuggestions();

  useInterrupt({
    render: ({ event, resolve }) => (
      <StepSelector
        steps={event.value?.steps || []}
        onConfirm={(selectedSteps) => {
          resolve(
            "The user selected the following steps: " +
              selectedSteps.map((s) => s.description).join(", "),
          );
        }}
      />
    ),
  });

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
    render: ({ args, respond, status }: any) => (
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
