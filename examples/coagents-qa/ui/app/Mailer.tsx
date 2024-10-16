"use client";

import React, { useState } from "react";
import { useCopilotAction } from "@copilotkit/react-core";
import { CopilotPopup } from "@copilotkit/react-ui";

export const Mailer: React.FC = () => {
  const [prePopulatedText, setPrePopulatedText] = useState<string>("");

  // Function to auto-populate the textarea with predefined content
  const handleAutoPopulate = () => {
    setPrePopulatedText("Dear CEO, I would like to schedule a meeting...");
  };

  // Function to clear the text area
  const handleClearText = () => {
    setPrePopulatedText("");
  };

  // Copilot action to manage email submission or canceling
  useCopilotAction({
    name: "EmailTool",
    parameters: [
      {
        name: "the_email",
        value: prePopulatedText, // Set the email content as the pre-populated text
      },
    ],
    renderAndWait: ({ args, status, handler }) => {
      return (
        <div className="p-4 bg-gray-100 rounded-lg">
          <div className="font-bold text-lg mb-2">Send this email?</div>
          <div className="text-gray-700">{args.the_email}</div>
          {status === "executing" && (
            <div className="mt-4 flex justify-end space-x-2">
              <button
                onClick={() => handler("CANCEL")}
                className="px-4 py-2 bg-slate-400 text-white rounded"
              >
                Cancel
              </button>
              <button
                onClick={() => handler("SEND")}
                className="px-4 py-2 bg-blue-500 text-white rounded"
              >
                Send
              </button>
            </div>
          )}
        </div>
      );
    },
  });

  return (
    <div className="flex flex-col items-center justify-center h-screen p-6">
      <div className="text-2xl mb-4">Email Q&A Example</div>
      <textarea
        className="w-full h-40 p-2 border border-gray-300 rounded-lg mb-4"
        value={prePopulatedText}
        placeholder="Write your email here..."
        onChange={(e) => setPrePopulatedText(e.target.value)}
      />
      <div className="flex space-x-2">
        <button
          className="px-4 py-2 bg-blue-500 text-white rounded"
          onClick={handleAutoPopulate}
        >
          Auto-populate Text
        </button>
        <button
          className="px-4 py-2 bg-gray-500 text-white rounded"
          onClick={handleClearText}
        >
          Clear Text
        </button>
      </div>

      <CopilotPopup defaultOpen={true} clickOutsideToClose={false} />
    </div>
  );
};

export default Mailer;
