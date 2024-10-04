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
    <div className="flex flex-col items-center justify-center h-screen">
      <div className="text-2xl">Email Q&A example</div>
      <div>e.g. write an email to the CEO of OpenAI asking for a meeting</div>

      <CopilotPopup defaultOpen={true} clickOutsideToClose={false} />
    </div>
  );
}
