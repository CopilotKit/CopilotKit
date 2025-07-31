import { PaymentCards } from "@/components/generative-ui/payment-cards";
import { CardInfo } from "@/lib/types";
import { useGlobalState } from "@/lib/stages";
import { useHumanInTheLoop, useCopilotAdditionalInstructions } from "@copilotkit/react-core";
import { z } from "zod";

export interface UseGetPaymentInfoStateOptions {
  enabled: boolean;
  onNextState: () => void;
}

/**
  useStateGetPaymentInfo is a hook that will add this stage to the state machine. It is responsible for:
  - Getting the payment information of the user.
  - Storing the payment information in the global state.
  - Moving to the next stage, confirmOrder.
*/
export function useStageGetPaymentInfo() {
  const { setCardInfo, stage, setStage } = useGlobalState();

  // Conditionally add additional instructions for the agent's prompt.
  useCopilotAdditionalInstructions(
    {
      instructions:
        "CURRENT STATE: You are now getting the payment information of the user. Say, 'Great! Now I need to get your payment information.' and MAKE SURE to then call the 'getPaymentInformation' action.",
      available: stage === "getPaymentInfo" ? "enabled" : "disabled",
    },
    [stage],
  );

  // Render the PaymentCards component and wait for the user's response.
  useHumanInTheLoop(
    {
      name: "getPaymentInformation",
      description: "Get the payment information of the user",
      available: stage === "getPaymentInfo" ? "enabled" : "disabled",
      parameters: z.object({}),
      render: ({ respond }) => {
        return (
          <PaymentCards
            onSubmit={(cardInfo: CardInfo) => {
              // Store the payment information in the global state.
              setCardInfo(cardInfo);

              // Let the agent know that the user has submitted their payment information.
              respond?.(
                "User has submitted their payment information, you are now moving to the next state",
              );

              // Move to the next stage, confirmOrder.
              setStage("confirmOrder");
            }}
          />
        );
      },
    },
    [stage],
  );
}
