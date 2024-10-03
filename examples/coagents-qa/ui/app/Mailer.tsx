"use client";

import { useCopilotAction } from "@copilotkit/react-core";
import { CopilotPopup } from "@copilotkit/react-ui";

export function Mailer() {
  useCopilotAction({
    name: "EmailTool",
    disabled: true,
    parameters: [
      {
        name: "the_email",
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
    <div className="flex flex-col items-center justify-center h-screen">
      <div className="text-2xl">Email Q&A example</div>
      <div>e.g. write an email to the CEO of OpenAI asking for a meeting</div>

      <CopilotPopup defaultOpen={true} clickOutsideToClose={false} />
    </div>
  );
}
