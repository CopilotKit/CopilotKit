"use client";

import { useCopilotAction } from "@copilotkit/react-core";
import { CopilotPopup } from "@copilotkit/react-ui";

export function WaitForUserInput() {
  useCopilotAction({
    name: "AskHuman",
    disabled: true,
    parameters: [
      {
        name: "question",
      },
    ],
    handler: async ({ question }) => {
      return window.prompt(question);
    },
  });

  return (
    <div className="flex flex-col items-center justify-center h-screen">
      <div className="text-2xl">LangGraph Wait For User Input Example</div>
      <div className="text-xs">
        (https://langchain-ai.github.io/langgraph/how-tos/human_in_the_loop/wait-user-input/#agent)
      </div>
      <div>
        Use the search tool to ask the user where they are, then look up the
        weather there
      </div>

      <CopilotPopup defaultOpen={true} clickOutsideToClose={false} />
    </div>
  );
}
