"use client";
import React, { useState, useEffect } from "react";
import "@copilotkit/react-ui/styles.css";
import "./style.css";
import { CopilotKit, useCopilotAction } from "@copilotkit/react-core";
import { CopilotChat, useCopilotChatSuggestions } from "@copilotkit/react-ui";
import { chatSuggestions, initialPrompt } from "@/lib/prompts";
import { AGENT_TYPE } from "@/config";
const HumanInTheLoop: React.FC = () => {
  return (
    <CopilotKit
      runtimeUrl={AGENT_TYPE == "general" ? "/api/copilotkit?crewai=true" : "/api/copilotkit"}
      showDevConsole={false}
      agent="human_in_the_loop"
    >
      <Chat />
    </CopilotKit>
  );
};


const Chat = () => {
  useCopilotAction({
    name: "generate_task_steps",
    parameters: [
      {
        name: "steps",
        type: "object[]",
        attributes: [
          {
            name: "description",
            type: "string",
          },
          {
            name: "status",
            type: "string",
            enum: ["enabled", "disabled", "executing"],
          },
        ],
      },
    ],
    renderAndWaitForResponse: ({ args, respond, status }) => {
      return <StepsFeedback args={args} respond={respond} status={status} />;
    },
  });


  useCopilotChatSuggestions({
    instructions: chatSuggestions.humanInTheLoop,
  })

  return (
    <div className="flex justify-center items-center h-full w-full">
      <div className="w-8/10 h-8/10 rounded-lg">
        <CopilotChat
          className="h-full rounded-2xl"
          labels={{ initial: initialPrompt.humanInTheLoop }}
        />
      </div>
    </div>
  );
};

const StepsFeedback = ({ args, respond, status }: { args: any, respond: any, status: any }) => {
  const [localSteps, setLocalSteps] = useState<
    {
      description: string;
      status: "disabled" | "enabled" | "executing";
    }[]
  >([]);
  const [newStep, setNewStep] = useState("");

  useEffect(() => {
    if (status === "executing" && localSteps.length === 0) {
      setLocalSteps(args.steps);
    }
  }, [status, args.steps, localSteps]);

  if (args.steps === undefined || args.steps.length === 0) {
    return <></>;
  }

  const steps = localSteps.length > 0 ? localSteps : args.steps;

  const handleCheckboxChange = (index: number) => {
    setLocalSteps((prevSteps) =>
      prevSteps.map((step, i) =>
        i === index
          ? {
            ...step,
            status: step.status === "enabled" ? "disabled" : "enabled",
          }
          : step
      )
    );
  };

  const handleAddStep = () => {
    const trimmed = newStep.trim();
    if (trimmed.length === 0) return;
    setLocalSteps((prevSteps) => [
      ...prevSteps,
      { description: trimmed, status: "enabled" },
    ]);
    setNewStep("");
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      handleAddStep();
    }
  };

  return (
    <div className="flex flex-col gap-4 w-[500px] bg-gray-100 rounded-lg p-8 mb-4">
      <div className=" text-black space-y-2">
        <h2 className="text-lg font-bold mb-4">Select Steps</h2>
        {steps.map((step: any, index: any) => (
          <div key={index} className="text-sm flex items-center">
            <label className="flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={step.status === "enabled"}
                onChange={() => {
                  if (respond) {
                    handleCheckboxChange(index)
                  }
                }}
                className="mr-2"
              />
              <span
                className={
                  step.status !== "enabled" && status != "inProgress"
                    ? "line-through"
                    : ""
                }
              >
                {step.description}
              </span>
            </label>
          </div>
        ))}
        <div className="flex items-center gap-2 mb-4">
          <input
            type="text"
            className="flex-1 rounded py-2 focus:outline-none"
            placeholder="Add a new step..."
            value={newStep}
            onChange={(e) => setNewStep(e.target.value)}
            onKeyDown={handleInputKeyDown}
            hidden={status != "executing"}
          />
        </div>
        {status === "executing" && (
          <button
            className="mt-4 bg-gradient-to-r from-purple-400 to-purple-600 text-white py-2 px-4 rounded cursor-pointer w-48 font-bold"
            onClick={() => {
              const selectedSteps = localSteps
                .filter((step) => step.status === "enabled")
                .map((step) => step.description);
              respond(
                "The user selected the following steps: " +
                selectedSteps.join(", ")
              );
            }}
          >
            ✨ Perform Steps
          </button>
        )}
      </div>
    </div>
  );
};

function Spinner() {
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
export default HumanInTheLoop;

