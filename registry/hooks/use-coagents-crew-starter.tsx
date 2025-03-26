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
} from "@/components/crews/crew-human-feedback-renderer";
import CrewStateRenderer from "@/components/crews/crew-state-renderer";
import { MessageRole, TextMessage } from "@copilotkit/runtime-client-gql";
import { CrewInChatInput } from "@/components/crews/crew-in-chat-input";

/**
 * Hook: useCoagentsCrewStarter
 *
 * This hook sets up a crew/agent and manages its lifecycle, including:
 * 1. Initializing the crew with a name and input fields.
 * 2. Handling user input through a form.
 * 3. Rendering the crew's real-time state.
 * 4. Managing feedback requests from the crew.
 *
 * @param {Object} params - Parameters for initializing the crew.
 * @param {string} params.crewName - The name of the crew.
 * @param {Array<string>} params.inputs - An array of input field names.
 * @returns {Object} - Contains the output result of the crew.
 */
export const useCoagentsCrewStarter = ({
  crewName,
  inputs,
}: {
  crewName: string;
  inputs: Array<string>;
}): {
  output: string;
} => {
  const [initialMessageSent, setInitialMessageSent] = useState(false);

  // Initialize the crew agent with a default state
  const { state, setState, run } = useCoAgent<
    CrewsAgentState & {
      result: string;
      inputs: Record<string, string>;
    }
  >({
    name: crewName,
    initialState: {
      inputs: {},
      result: "Crew result will appear here...",
    },
  });

  const { appendMessage, isLoading } = useCopilotChat();

  // Instructions for the copilot to ensure inputs are gathered before proceeding
  const instructions =
    "INPUTS ARE ABSOLUTELY REQUIRED. Please call getInputs before proceeding with anything else.";

  // Effect to send an initial message when the chat is loaded
  useEffect(() => {
    if (initialMessageSent || isLoading) return;

    setTimeout(async () => {
      await appendMessage(
        new TextMessage({
          content: "Hi, Please provide your inputs before we get started.",
          role: MessageRole.Developer,
        })
      );
      setInitialMessageSent(true);
    }, 0);
  }, [initialMessageSent, isLoading, appendMessage]);

  // Effect to send a message with the inputs once they are provided
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
    followUp: false,
    description:
      "This action allows Crew to get required inputs from the user before starting the Crew.",
    renderAndWaitForResponse({ status }) {
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
              await run();
            }}
          />
        );
      }
      return <>Inputs submitted</>;
    },
  });

  // Render the crew's state in real-time
  useCoAgentStateRender({
    name: crewName,
    render: ({ state, status }) => (
      <CrewStateRenderer state={state} status={status} />
    ),
  });

  // Action to handle feedback requests from the crew
  useCopilotAction({
    name: "crew_requesting_feedback",
    description: "Request feedback from the user",
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
