"use client";
import React, { useState, useEffect } from "react";
import "@copilotkit/react-ui/styles.css";
import "./style.css";
import { CopilotKit, useLangGraphInterrupt } from "@copilotkit/react-core";
import { CopilotChat, useCopilotChatSuggestions } from "@copilotkit/react-ui";
import { initialPrompt, chatSuggestions } from "@/lib/prompts";
import { AGENT_TYPE } from "@/config";
const HumanInTheLoop: React.FC = () => {
  return (
    <CopilotKit
      runtimeUrl={AGENT_TYPE == "general" ? "/api/copilotkit?langgraph=true" : "/api/copilotkit"}
      showDevConsole={false}
      agent="human_in_the_loop"
    >
      <Chat />
    </CopilotKit>
  );
};

const Chat = () => {
  useLangGraphInterrupt({
    render: ({ event, resolve }) => {
      const [newStep, setNewStep] = useState("");

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
      // Ensure we have valid steps data
      let initialSteps = [];
      if (event.value && event.value.steps && Array.isArray(event.value.steps)) {
        initialSteps = event.value.steps.map((step: any) => ({
          description: typeof step === 'string' ? step : step.description || '',
          status: (typeof step === 'object' && step.status) ? step.status : 'enabled'
        }));
      }

      const [localSteps, setLocalSteps] = useState<
        {
          description: string;
          status: "disabled" | "enabled" | "executing";
        }[]
      >(initialSteps);

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

      return (
        <div className="flex flex-col gap-4 w-[500px] bg-gray-100 rounded-lg p-8 mb-4">
          <div className="text-black space-y-2">
            <h2 className="text-lg font-bold mb-4">Select Steps</h2>
            {localSteps.map((step, index) => (
              <div key={index} className="text-sm flex items-center">
                <label className="flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={step.status === "enabled"}
                    onChange={() => handleCheckboxChange(index)}
                    className="mr-2"
                  />
                  <span
                    className={
                      step.status !== "enabled" ? "line-through" : ""
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
                // hidden={status != "executing"}
              />
            </div>
            <button
              className="mt-4 bg-gradient-to-r from-purple-400 to-purple-600 text-white py-2 px-4 rounded cursor-pointer w-48 font-bold"
              onClick={() => {
                const selectedSteps = localSteps
                  .filter((step) => step.status === "enabled")
                  .map((step) => step.description);
                resolve("The user selected the following steps: " + selectedSteps.join(", "));
              }}
            >
              ✨ Perform Steps
            </button>
          </div>
        </div>
      );
    },
  });
  useCopilotChatSuggestions({
    instructions: chatSuggestions.humanInTheLoop,
  })
  return (
    <div className="flex justify-center items-center h-screen w-screen">
      <div className="w-8/10 h-8/10">
        <CopilotChat
          className="h-full rounded-lg"
          labels={{ initial: initialPrompt.humanInTheLoop }}
        />
      </div>
    </div>
  );
};

export default HumanInTheLoop;
