"use client";

import React from "react";
import { CopilotKit } from "@copilotkit/react-core";
import {
  CopilotChat,
  useAgent,
  UseAgentUpdate,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";

interface AgentState {
  steps: {
    description: string;
    status: "pending" | "completed";
  }[];
}

export default function GenUiAgentDemo() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit" agent="gen-ui-agent">
      <Chat />
    </CopilotKit>
  );
}

function Chat() {
  const { agent } = useAgent({
    agentId: "gen-ui-agent",
    updates: [UseAgentUpdate.OnStateChanged],
  });

  const agentState = agent.state as AgentState | undefined;

  useConfigureSuggestions({
    suggestions: [
      {
        title: "Simple plan",
        message: "Please build a plan to go to mars in 5 steps.",
      },
      {
        title: "Complex plan",
        message: "Please build a plan to make pizza in 10 steps.",
      },
    ],
    available: "always",
  });

  const steps = agentState?.steps;

  return (
    <div className="flex justify-center items-center h-full w-full">
      <div className="h-full w-full md:w-4/5 md:h-4/5 rounded-lg">
        <CopilotChat
          agentId="gen-ui-agent"
          className="h-full rounded-2xl max-w-6xl mx-auto"
          messageView={{
            children: ({ messageElements, interruptElement }) => (
              <div data-testid="copilot-message-list" className="flex flex-col">
                {messageElements}
                {steps && steps.length > 0 && (
                  <div className="my-4">
                    <TaskProgress steps={steps} />
                  </div>
                )}
                {interruptElement}
              </div>
            ),
          }}
        />
      </div>
    </div>
  );
}

function TaskProgress({ steps }: { steps: AgentState["steps"] }) {
  const completedCount = steps.filter(
    (step) => step.status === "completed",
  ).length;
  const progressPercentage = (completedCount / steps.length) * 100;

  return (
    <div className="flex justify-center w-full px-4">
      <div
        data-testid="task-progress"
        className="relative rounded-xl w-[700px] p-6 shadow-lg bg-white border border-gray-200/80"
      >
        <div className="mb-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xl font-bold">Task Progress</h3>
            <div className="text-sm text-gray-500">
              {completedCount}/{steps.length} Complete
            </div>
          </div>

          <div className="relative h-2 rounded-full overflow-hidden bg-gray-200">
            <div
              className="absolute top-0 left-0 h-full bg-blue-500 rounded-full transition-all duration-1000"
              style={{ width: `${progressPercentage}%` }}
            />
          </div>
        </div>

        <div className="space-y-2">
          {steps.map((step, index) => (
            <div
              key={index}
              className={`p-2.5 rounded-lg border ${
                step.status === "completed"
                  ? "bg-green-50 border-green-200"
                  : "bg-gray-50 border-gray-200"
              }`}
            >
              <div
                data-testid="task-step-text"
                className="font-semibold text-sm"
              >
                {step.description}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
