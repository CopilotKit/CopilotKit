import { PaymentCards } from "@/components/generative-ui/payment-cards";
import type { CardInfo } from "@/lib/types";
import { useGlobalState } from "@/lib/stages";
import { useHumanInTheLoop } from "@copilotkit/react-core/v2";
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

  // Render the PaymentCards component and wait for the user's response.
  useHumanInTheLoop(
    {
      name: "getPaymentInformation",
      description: "Get the payment information of the user",
      available: stage === "getPaymentInfo",
      parameters: z.object({}),
      render: ({ status, respond }) => {
        return (
          <PaymentCards
            status={status}
            onSubmit={async (cardInfo: CardInfo) => {
              if (!respond) return;

              // Store the payment information in the global state.
              setCardInfo(cardInfo);

              // Move to the next stage, confirmOrder.
              setStage("confirmOrder");

              // Let the agent know that the user has submitted their payment information.
              await respond(
                "User has submitted their payment information, you are now moving to the next state",
              );
            }}
          />
        );
      },
    },
    [stage],
  );
}
