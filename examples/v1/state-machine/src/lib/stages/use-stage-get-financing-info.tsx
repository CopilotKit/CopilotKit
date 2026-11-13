import { FinancingForm } from "@/components/generative-ui/financing-form";
import { useGlobalState } from "@/lib/stages";
import { useHumanInTheLoop } from "@copilotkit/react-core/v2";
import { z } from "zod";

/**
  useStateGetFinancingInfo is a hook that will add this stage to the state machine. It is responsible for:
  - Getting the financing information of the user.
  - Storing the financing information in the global state.
  - Moving to the next stage, confirmOrder.
*/
export function useStageGetFinancingInfo() {
  const { setFinancingInfo, stage, setStage } = useGlobalState();

  // Render the FinancingForm component and wait for the user's response.
  useHumanInTheLoop(
    {
      name: "getFinancingInformation",
      description: "Get the financing information of the user",
      available: stage === "getFinancingInfo",
      parameters: z.object({}),
      render: ({ status, respond }) => {
        return (
          <FinancingForm
            status={status}
            onSubmit={async (creditScore, loanTerm) => {
              if (!respond) return;

              // Store the financing information in the global state.
              setFinancingInfo({ creditScore, loanTerm });

              // Move to the next stage, confirmOrder.
              setStage("confirmOrder");

              // Let the agent know that the user has submitted their financing information.
              await respond(
                "User has submitted their financing information, moving to the next state",
              );
            }}
          />
        );
      },
    },
    [stage],
  );
}
