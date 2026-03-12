import { LocationForm } from "@/components/LocationForm";
import { useGlobalContext } from "@/context/GlobalContext";
import {
  useCopilotAction,
  useCopilotAdditionalInstructions,
  useCopilotChat,
} from "@copilotkit/react-core";
import { TextMessage, MessageRole } from "@copilotkit/runtime-client-gql";
import { useEffect } from "react";

export function useInput({
  onInputSubmit,
}: {
  onInputSubmit: (input: string) => void;
}) {
  const { appendMessage, isLoading } = useCopilotChat();

  const { location, initialMessageSent, setInitialMessageSent } =
    useGlobalContext();

  // Render an initial message when the chat is first loaded
  useEffect(() => {
    if (initialMessageSent || isLoading) return;

    setTimeout(() => {
      console.log("Appending message");
      appendMessage(
        new TextMessage({
          content: "Hi, Please provide your location before we get started.",
          role: MessageRole.Assistant,
        })
      );
      console.log("Message appended");
      setInitialMessageSent(true);
    }, 500);
  }, [initialMessageSent, appendMessage, isLoading, setInitialMessageSent]);

  const instructions =
    "LOCATION IS ABSOLUTELY REQUIRED. Please get location from the user before proceeding. Once you get the location, please kick off the agent.";

  useCopilotAdditionalInstructions({
    instructions,
    available: Boolean(location.city) ? "enabled" : "disabled",
  });

  useCopilotAction({
    name: "get_input",
    followUp: false,
    description:
      "This is used for getting inputs from the user. It is absolutely required to get the input before proceeding.",
    renderAndWaitForResponse({ status, respond }) {
      if (status === "inProgress" || status === "executing") {
        return (
          <LocationForm
            onSubmit={async (city) => {
              respond?.(`User's location is ${city}`);
              await onInputSubmit(city);
            }}
          />
        );
      }
      return <></>;
    },
  });
}
