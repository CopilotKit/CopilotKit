"use client";
import {
  CrewsAgentState,
  CrewsResponseStatus,
  useCoAgent,
  useCoAgentStateRender,
  useCopilotAction,
  useCopilotAdditionalInstructions,
  useCopilotChat,
} from "@copilotkit/react-core";
import { useEffect, useState } from "react";
import CrewHumanFeedbackRenderer, {
  CrewsFeedback,
} from "@/registry/crews/crew-human-feedback-renderer";
import CrewStateRenderer from "@/registry/crews/crew-state-renderer";
import { MessageRole, TextMessage } from "@copilotkit/runtime-client-gql";
import { CrewInChatInput } from "@/registry/crews/crew-in-chat-input";

/**
 * Hook: useCoagentsCrewStarter
 *
 * This hook provides a simplified interface for initializing and managing 
 * a copilot crew in your application. It handles:
 * 
 * 1. Initialization with configured agent name from environment variables
 * 2. Collection of user inputs through a form interface
 * 3. Real-time state visualization during execution
 * 4. Feedback collection when the crew needs user input
 * 5. Result aggregation and presentation
 *
 * @param {Object} params - Parameters for initializing the crew
 * @param {Array<string>} params.inputs - Input field names to collect from the user
 * @returns {Object} - An object containing the crew's output
 * 
 * @example
 * ```tsx
 * const { output } = useCoagentsCrewStarter({
 *   inputs: ["query", "location"]
 * });
 * ```
 */
export const useCoagentsCrewStarter = ({
  inputs,
}: {
  inputs: Array<string>;
}): {
  output: string;
} => {
  const [initialMessageSent, setInitialMessageSent] = useState(false);
  
  // Use the agent name from environment variables
  const agentName = process.env.NEXT_PUBLIC_COPILOTKIT_AGENT_NAME || "DefaultAgent";

  // Initialize the crew agent with a default state
  const { state, setState, run } = useCoAgent<
    CrewsAgentState & {
      result: string;
      inputs: Record<string, string>;
    }
  >({
    name: agentName,
    initialState: {
      inputs: {},
      result: "Crew result will appear here...",
    },
  });

  const { appendMessage, isLoading } = useCopilotChat();

  // Instructions for the copilot to ensure inputs are gathered
  const instructions =
    "INPUTS ARE ABSOLUTELY REQUIRED. Please call getInputs before proceeding with anything else.";

  // Send initial greeting when chat is loaded
  useEffect(() => {
    if (initialMessageSent || isLoading) return;

    setTimeout(async () => {
      await appendMessage(
        new TextMessage({
          content: "Hi! Please provide your inputs to get started.",
          role: MessageRole.Developer,
        })
      );
      setInitialMessageSent(true);
    }, 0);
  }, [initialMessageSent, isLoading, appendMessage]);

  // Send a message with the inputs once they are provided
  useEffect(() => {
    if (!initialMessageSent && Object.values(state?.inputs || {}).length > 0) {
      appendMessage(
        new TextMessage({
          role: MessageRole.Developer,
          content: "My inputs are: " + JSON.stringify(state?.inputs),
        })
      ).then(() => {
        setInitialMessageSent(true);
      });
    }
  }, [initialMessageSent, state?.inputs, appendMessage]);

  // Provide additional instructions to the copilot
  useCopilotAdditionalInstructions({
    instructions,
    available:
      Object.values(state?.inputs || {}).length > 0 ? "enabled" : "disabled",
  });

  // Action to get inputs from the user
  useCopilotAction({
    name: "getInputs",
    description:
      "Collect required inputs from the user before starting the crew execution.",
    renderAndWaitForResponse({ status, respond }) {
      if (status === "inProgress" || status === "executing") {
        return (
          <CrewInChatInput
            status={status}
            inputs={inputs}
            onSubmit={async (inputValues) => {
              setState({
                ...state,
                inputs: inputValues,
              });
              respond?.("Inputs submitted");
            }}
          />
        );
      }
      return <div className="text-sm text-zinc-500">Inputs submitted</div>;
    },
  });

  // Render the crew's state in real-time
  useCoAgentStateRender({
    name: agentName,
    render: ({ state, status }) => (
      <CrewStateRenderer state={state} status={status} />
    ),
  });

  // Action to handle feedback requests from the crew
  useCopilotAction({
    name: "crew_requesting_feedback",
    description: "Request feedback from the user on the crew's output",
    renderAndWaitForResponse(props) {
      const { status, args, respond } = props;
      return (
        <CrewHumanFeedbackRenderer
          feedback={args as unknown as CrewsFeedback}
          respond={respond}
          status={status as CrewsResponseStatus}
        />
      );
    },
  });

  // Return the output result of the crew
  return {
    output: state?.result || "",
  };
};
