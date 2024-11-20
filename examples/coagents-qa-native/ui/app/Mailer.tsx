"use client";

import { useModelSelectorContext } from "@/lib/model-selector-provider";
import { useCoAgent, useCopilotAction } from "@copilotkit/react-core";
import { CopilotPopup } from "@copilotkit/react-ui";

export function Mailer() {
  const { model } = useModelSelectorContext();
  useCoAgent({
    name: "email_agent",
    initialState: {
      model,
    },
  });

  useCopilotAction({
    name: "EmailTool",
    disabled: true,
    parameters: [
      {
        name: "the_email",
      },
    ],

    handler: async ({ the_email }) => {
      const result = window.confirm(the_email);
      if (result) {
        return "SEND";
      } else {
        return "CANCEL";
      }
    },
  });

  return (
    <div
      className="flex flex-col items-center justify-center h-screen"
      data-test-id="mailer-container"
    >
      <div className="text-2xl" data-test-id="mailer-title">
        Email Q&A example
      </div>
      <div data-test-id="mailer-example">
        e.g. write an email to the CEO of OpenAI asking for a meeting
      </div>

      <CopilotPopup
        defaultOpen={true}
        clickOutsideToClose={false}
        data-test-id="mailer-popup"
      />

      {/* These will be dynamically added by the handler */}
      <div data-test-id="email-success-message" className="hidden">
        ✅ Sent email.
      </div>
      <div data-test-id="email-cancel-message" className="hidden">
        ❌ Cancelled sending email.
      </div>
    </div>
  );
}
