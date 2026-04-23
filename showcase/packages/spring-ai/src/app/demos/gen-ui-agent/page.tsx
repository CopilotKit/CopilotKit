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
        className="relative rounded-xl w-[700px] p-6 shadow-lg backdrop-blur-sm bg-gradient-to-br from-white via-gray-50 to-white text-gray-800 border border-gray-200/80"
      >
        {/* Header */}
        <div className="mb-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
              Task Progress
            </h3>
            <div className="text-sm text-gray-500">
              {completedCount}/{steps.length} Complete
            </div>
          </div>

          <div className="relative h-2 rounded-full overflow-hidden bg-gray-200">
            <div
              className="absolute top-0 left-0 h-full bg-gradient-to-r from-blue-500 to-purple-500 rounded-full transition-all duration-1000 ease-out"
              style={{ width: `${progressPercentage}%` }}
            />
          </div>
        </div>

        {/* Steps */}
        <div className="space-y-2">
          {steps.map((step, index) => {
            const isCompleted = step.status === "completed";
            const isCurrentPending =
              step.status === "pending" &&
              index === steps.findIndex((s) => s.status === "pending");

            return (
              <div
                key={index}
                className={`relative flex items-center p-2.5 rounded-lg transition-all duration-500 ${
                  isCompleted
                    ? "bg-gradient-to-r from-green-50 to-emerald-50 border border-green-200/60"
                    : isCurrentPending
                      ? "bg-gradient-to-r from-blue-50 to-purple-50 border border-blue-200/60 shadow-md shadow-blue-200/50"
                      : "bg-gray-50/50 border border-gray-200/60"
                }`}
              >
                {/* Connector Line */}
                {index < steps.length - 1 && (
                  <div className="absolute left-5 top-full w-0.5 h-2 bg-gradient-to-b from-gray-300 to-gray-400" />
                )}

                {/* Status Icon */}
                <div
                  className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center mr-2 ${
                    isCompleted
                      ? "bg-gradient-to-br from-green-500 to-emerald-600 shadow-md shadow-green-200"
                      : isCurrentPending
                        ? "bg-gradient-to-br from-blue-500 to-purple-600 shadow-md shadow-blue-200"
                        : "bg-gray-300 border border-gray-400"
                  }`}
                >
                  {isCompleted ? (
                    <CheckIcon />
                  ) : isCurrentPending ? (
                    <SpinnerIcon />
                  ) : (
                    <ClockIcon />
                  )}
                </div>

                {/* Step Content */}
                <div className="flex-1 min-w-0">
                  <div
                    data-testid="task-step-text"
                    className={`font-semibold transition-all duration-300 text-sm ${
                      isCompleted
                        ? "text-green-700"
                        : isCurrentPending
                          ? "text-blue-700 text-base"
                          : "text-gray-500"
                    }`}
                  >
                    {step.description}
                  </div>
                  {isCurrentPending && (
                    <div className="text-sm mt-1 animate-pulse text-blue-600">
                      Processing...
                    </div>
                  )}
                </div>

                {isCurrentPending && (
                  <div className="absolute inset-0 rounded-lg bg-gradient-to-r animate-pulse from-blue-100/50 to-purple-100/50" />
                )}
              </div>
            );
          })}
        </div>

        {/* Decorative Elements */}
        <div className="absolute top-3 right-3 w-16 h-16 rounded-full blur-xl bg-gradient-to-br from-blue-200/30 to-purple-200/30" />
        <div className="absolute bottom-3 left-3 w-12 h-12 rounded-full blur-xl bg-gradient-to-br from-green-200/30 to-emerald-200/30" />
      </div>
    </div>
  );
}

function CheckIcon() {
  return (
    <svg
      className="w-4 h-4 text-white"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={3}
        d="M5 13l4 4L19 7"
      />
    </svg>
  );
}

function SpinnerIcon() {
  return (
    <svg
      className="w-4 h-4 animate-spin text-white"
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
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg
      className="w-3 h-3 text-gray-600"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <circle cx="12" cy="12" r="10" strokeWidth="2" />
      <polyline points="12,6 12,12 16,14" strokeWidth="2" />
    </svg>
  );
}
