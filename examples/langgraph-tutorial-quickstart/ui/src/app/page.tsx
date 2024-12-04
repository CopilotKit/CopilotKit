"use client";
import { useCopilotAction } from "@copilotkit/react-core";
import { CopilotPopup } from "@copilotkit/react-ui";
import { useState } from "react";

export default function YourApp() {
  useCopilotAction({
    name: "RequestAssistance",
    parameters: [
      {
        name: "request",
        type: "string",
      },
    ],
    renderAndWait: ({ args, status, handler }) => {
      const [response, setResponse] = useState("");
      return (
        <div className="p-4 bg-gray-100 rounded shadow-md">
          <p className="mb-2 text-gray-700">{args.request}</p>
          <div className="flex items-center space-x-2">
            <input
              type="text"
              className="flex-grow p-2 border border-gray-300 rounded"
              placeholder="Your response..."
              style={{ maxWidth: "calc(100% - 100px)" }}
              value={response}
              onChange={(e) => setResponse(e.target.value)}
            />
            {status === "executing" && (
              <button
                className="px-4 py-2 text-white bg-blue-500 rounded hover:bg-blue-600"
                onClick={() => handler(response)}
              >
                Submit
              </button>
            )}
          </div>
        </div>
      );
    },
  });
  return (
    <>
      <CopilotPopup
        instructions={
          "You are assisting the user as best as you can. Answer in the best way possible given the data you have."
        }
        defaultOpen={true}
        labels={{
          title: "Popup Assistant",
          initial: "Need any help?",
        }}
      />
    </>
  );
}
