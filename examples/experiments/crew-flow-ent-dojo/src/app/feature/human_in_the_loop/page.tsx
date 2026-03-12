"use client";
import React, { useState, useEffect } from "react";
import "@copilotkit/react-ui/styles.css";
import "./style.css";
import { CopilotKit, useCopilotAction } from "@copilotkit/react-core";
import { CopilotChat } from "@copilotkit/react-ui";
import { initialPrompt } from "@/lib/prompts";

const HumanInTheLoop: React.FC = () => {
  return (
    <CopilotKit
      runtimeUrl="/api/copilotkit"
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
            name: "enabled",
            type: "string",
          },
          {
            name: "step_number",
            type: "string",
          },
        ],
      },
    ],
    renderAndWaitForResponse: ({ args, respond, status }) => {
      console.log("args", args);
      const modifiedArgs = {
        ...args,
        steps: args?.steps?.map((step) => ({
          ...step,
          enabled: step.enabled === "True",
        })),
      };

      return (
        <StepsFeedback args={modifiedArgs} respond={respond} status={status} />
      );
    },
  });

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

const StepsFeedback = ({
  args,
  respond,
  status,
}: {
  args: any;
  respond: any;
  status: any;
}) => {
  const [localSteps, setLocalSteps] = useState<
    {
      description: string;
      enabled: boolean;
      step_number: number;
    }[]
  >([]);
  const [newStep, setNewStep] = useState("");

  console.log("args.steps", args.steps);

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
    console.log("handleCheckboxChange", index);
    setLocalSteps((prevSteps) =>
      prevSteps.map((step, i) =>
        i === index
          ? {
              ...step,
              enabled: !step.enabled,
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
      { description: trimmed, enabled: true, step_number: 0 },
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
                checked={step.enabled}
                onChange={() => {
                  if (respond) {
                    handleCheckboxChange(index);
                  }
                }}
                className="mr-2"
              />
              <span
                className={
                  !step.enabled && status != "inProgress" ? "line-through" : ""
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
                .filter((step) => step.enabled)
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

export default HumanInTheLoop;
