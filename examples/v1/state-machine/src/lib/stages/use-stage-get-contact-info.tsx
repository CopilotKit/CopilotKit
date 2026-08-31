import { ContactInfo } from "@/components/generative-ui/contact-info";
import { useGlobalState } from "@/lib/stages";
import { useHumanInTheLoop } from "@copilotkit/react-core/v2";
import { z } from "zod";

export interface UseGetContactInfoStateOptions {
  enabled: boolean;
  onNextState: () => void;
}

/**
  useStateGetContactInfo is a hook that will add this stage to the state machine. It is responsible for:
  - Getting the contact information of the user.
  - Storing the contact information in the global state.
  - Moving to the next stage, buildCar.
*/
export function useStageGetContactInfo() {
  const { setContactInfo, stage, setStage } = useGlobalState();

  // Render the ContactInfo component and wait for the user's response.
  useHumanInTheLoop(
    {
      name: "getContactInformation",
      description: "Get the contact information of the user",
      available: stage === "getContactInfo",
      parameters: z.object({}),
      render: ({ status, respond }) => {
        return (
          <ContactInfo
            status={status}
            onSubmit={async (name, email, phone) => {
              if (!respond) return;

              // Commit the contact information to the global state.
              setContactInfo({ name, email, phone });

              // This move the state machine to the next stage, buildCar deterministically.
              setStage("buildCar");

              // Let the agent know that the user has submitted their contact information.
              await respond("User has submitted their contact information.");
            }}
          />
        );
      },
    },
    [stage],
  );
}
