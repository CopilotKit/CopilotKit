"use client";
import React, { useState, useEffect } from "react";
import "@copilotkit/react-ui/styles.css";
import "./style.css";
import { CopilotKit, useCopilotAction, useLangGraphInterrupt } from "@copilotkit/react-core";
import { CopilotChat, useCopilotChatSuggestions } from "@copilotkit/react-ui";
import { initialPrompt, chatSuggestions, instructions } from "@/lib/prompts";
const HumanInTheLoop: React.FC = () => {
  return (
    <CopilotKit
      runtimeUrl="/api/copilotkit?standard=true"
      showDevConsole={false}
    >
      <Chat />
    </CopilotKit>
  );
};

const Chat = () => {
  // useLangGraphInterrupt({
  //   render: ({ event, resolve }) => {

  //     // Ensure we have valid steps data
  //     let initialSteps = [];
  //     if (event.value && event.value.steps && Array.isArray(event.value.steps)) {
  //       initialSteps = event.value.steps.map((step: any) => ({
  //         description: typeof step === 'string' ? step : step.description || '',
  //         status: (typeof step === 'object' && step.status) ? step.status : 'enabled'
  //       }));
  //     }

  //     const [localSteps, setLocalSteps] = useState<
  //       {
  //         description: string;
  //         status: "disabled" | "enabled" | "executing";
  //       }[]
  //     >(initialSteps);

  //     const handleCheckboxChange = (index: number) => {
  //       setLocalSteps((prevSteps) =>
  //         prevSteps.map((step, i) =>
  //           i === index
  //             ? {
  //               ...step,
  //               status: step.status === "enabled" ? "disabled" : "enabled",
  //             }
  //             : step
  //         )
  //       );
  //     };

  //     return (
  //       <div className="flex flex-col gap-4 w-[500px] bg-gray-100 rounded-lg p-8 mb-4">
  //         <div className="text-black space-y-2">
  //           <h2 className="text-lg font-bold mb-4">Select Steps</h2>
  //           {localSteps.map((step, index) => (
  //             <div key={index} className="text-sm flex items-center">
  //               <input
  //                 type="checkbox"
  //                 checked={step.status === "enabled"}
  //                 onChange={() => handleCheckboxChange(index)}
  //                 className="mr-2"
  //               />
  //               <span
  //                 className={
  //                   step.status !== "enabled" ? "line-through" : ""
  //                 }
  //               >
  //                 {step.description}
  //               </span>
  //             </div>
  //           ))}
  //           <button
  //             className="mt-4 bg-gradient-to-r from-purple-400 to-purple-600 text-white py-2 px-4 rounded cursor-pointer w-48 font-bold"
  //             onClick={() => {
  //               const selectedSteps = localSteps
  //                 .filter((step) => step.status === "enabled")
  //                 .map((step) => step.description);
  //               resolve("The user selected the following steps: " + selectedSteps.join(", "));
  //             }}
  //           >
  //             ✨ Perform Steps
  //           </button>
  //         </div>
  //       </div>
  //     );
  //   },
  // });

  useCopilotAction({
    name: "generate_task_steps",
    description: "Make up 10 steps (only a couple of words per step) that are required for a task. The step should be in imperative form (i.e. Dig hole, Open door, ...). When the user responds with selected steps, you must generate the summary with the selected steps.",
    parameters: [
      {
        type: "object[]",
        name: "items",
        description: "An array of 10 step objects, each containing text and status",
        attributes: [
          {
            type: "string",
            name: "description",
            description: "The text of the step in imperative form"
          },
          {
            type: "string",
            name: "status",
            description: "The status of the step, always 'enabled'"
          }
        ]
      }
    ],
    renderAndWaitForResponse: ({ args, respond, status }) => {
      useEffect(() => {
        console.log(args, "args.steps")
        setLocalSteps(args?.items || [])
      }, [args])
      const [localSteps, setLocalSteps] = useState<
        {
          description: string;
          status: string;
        }[]
      >(args?.items || [])
      const handleCheckboxChange = (index: number) => {
        debugger
        const newSteps = [...localSteps];
        newSteps[index].status = newSteps[index].status === "enabled" ? "disabled" : "enabled";
        setLocalSteps(newSteps);
      };
      return (localSteps) ? <div className="flex flex-col gap-4 w-[500px] bg-gray-100 rounded-lg p-8 mb-4">
        <div className="text-black space-y-2">
          <h2 className="text-lg font-bold mb-4">Select Steps</h2>
          {localSteps.map((step: any, index: number) => (
            <div key={index} className="text-sm flex items-center">
              <label className="flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={step.status == "enabled"}
                  onChange={() => {
                    if (respond) {
                      handleCheckboxChange(index)
                    }
                  }}
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
          <button
            className="mt-4 bg-gradient-to-r from-purple-400 to-purple-600 text-white py-2 px-4 rounded cursor-pointer w-48 font-bold"
            hidden={!respond}
            onClick={() => {
              if (respond) {
                console.log(`The user has selected the following steps: ${localSteps.filter((step) => step.status === "enabled").map((step) => step.description).join(", ")}`)
                respond(`The user has selected the following steps: ${localSteps.filter((step) => step.status === "enabled").map((step) => step.description).join(", ")}`)
              }
            }}
          >
            ✨ Perform Steps
          </button>
        </div>
      </div> : <></>
    }
  })


  useCopilotChatSuggestions({
    instructions: chatSuggestions.humanInTheLoop,
  })
  return (
    <div className="flex justify-center items-center h-screen w-screen">
      <div className="w-8/10 h-8/10">
        <CopilotChat
          className="h-full rounded-lg"
          labels={{ initial: initialPrompt.humanInTheLoop }}
          instructions={instructions.humanInTheLoop}
        />
      </div>
    </div>
  );
};

export default HumanInTheLoop;
