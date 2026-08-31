import { useGlobalState } from "@/lib/stages";
import type { Order } from "@/lib/types";
import { ConfirmOrder } from "@/components/generative-ui/confirm-order";

import { useFrontendTool, useHumanInTheLoop } from "@copilotkit/react-core/v2";
import { z } from "zod";

/**
  useStageConfirmOrder is a hook that will add this stage to the state machine. It is responsible for:
  - Confirming the order of the user.
  - Storing the order in the global state.
  - Optionally, can decide to move to the next stage, buildCar, based on the user's responses.
*/
export function useStageConfirmOrder() {
  const { setOrders, stage, setStage } = useGlobalState();

  // Conditionally add the nextState action to the state machine. Agent will decide if it should be called.
  useFrontendTool(
    {
      name: "nextState",
      description: "Proceed to next state",
      available: stage === "confirmOrder",
      parameters: z.object({}),
      handler: async () => {
        setStage("getContactInfo");
        return "Started a new order";
      },
    },
    [stage],
  );

  // Render the ConfirmOrder component and wait for the user's response.
  useHumanInTheLoop(
    {
      name: "confirmOrder",
      description: "Confirm the order of the user",
      available: stage === "confirmOrder",
      parameters: z.object({}),
      render: ({ status, respond }) => {
        return (
          <ConfirmOrder
            status={status}
            onConfirm={async (order: Order) => {
              if (!respond) return;

              // Let the agent know that the user has confirmed their order.
              await respond(
                "User confirmed their order, please ask them if they would like to place a another order and if they do, call the 'nextState' action.",
              );

              // Commit the order only after the response succeeds.
              setOrders((prevOrders) => [...prevOrders, order]);
            }}
            onCancel={async () => {
              if (!respond) return;

              // Let the agent know that the user has cancelled their order.
              await respond(
                "User cancelled their order, please ask them if they'd like to start over with a new order or if they'd like to continue with their current order. If they'd like to start over, call the 'nextState' action. If they'd like to continue with their current order, call the 'confirmOrder' action.",
              );
            }}
          />
        );
      },
    },
    [stage],
  );
}
