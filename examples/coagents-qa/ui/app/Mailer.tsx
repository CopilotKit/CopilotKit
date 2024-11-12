"use client";

import React from "react";
import { useCopilotAction } from "@copilotkit/react-core";
import { CopilotPopup } from "@copilotkit/react-ui";

export function Mailer() {
  useCopilotAction({
    name: "EmailTool",
    disabled: true,
    parameters: [
      {
        name: "email_draft",
        type: "string",
        description: "The email content",
        required: true,
      },
    ],
    renderAndWait: ({ args, status, handler }) => (
      <EmailConfirmation
        emailContent={args.email_draft || ""}
        isExecuting={status === "executing"}
        onCancel={() => handler?.("CANCEL")} // the handler is undefined while status is "executing"
        onSend={() => handler?.("SEND")} // the handler is undefined while status is "executing"
      />
    ),
  });

  return (
    <div className="flex flex-col items-center justify-center h-screen">
      <div className="text-2xl">Email Q&A example</div>
      <div>e.g. write an email to the CEO of OpenAI asking for a meeting</div>

      <CopilotPopup defaultOpen={true} clickOutsideToClose={false} />
    </div>
  );
}

interface EmailConfirmationProps {
  emailContent: string;
  isExecuting: boolean;
  onCancel: () => void;
  onSend: () => void;
}

const EmailConfirmation: React.FC<EmailConfirmationProps> = ({
  emailContent,
  isExecuting,
  onCancel,
  onSend,
}) => {
  return (
    <div className="p-4 bg-gray-100 rounded-lg">
      <div className="font-bold text-lg mb-2">Send this email?</div>
      <div className="text-gray-700">{emailContent}</div>
      {isExecuting && (
        <div className="mt-4 flex justify-end space-x-2">
          <button
            onClick={onCancel}
            className="px-4 py-2 bg-slate-400 text-white rounded"
          >
            Cancel
          </button>
          <button
            onClick={onSend}
            className="px-4 py-2 bg-blue-500 text-white rounded"
          >
            Send
          </button>
        </div>
      )}
    </div>
  );
};
