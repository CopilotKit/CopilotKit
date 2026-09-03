import { useGlobalState } from "@/lib/stages";
import type { Order } from "@/lib/types";
import { ConfirmOrder } from "@/components/generative-ui/confirm-order";
import { createOrderConfirmation } from "@/components/generative-ui/selected-payment";

import { useFrontendTool, useHumanInTheLoop } from "@copilotkit/react-core/v2";
import { useRef } from "react";
import { z } from "zod";

/** Copy an order so later draft edits cannot change its confirmation card. */
function snapshotOrder(order: Order): Order {
  return {
    ...order,
    car: {
      ...order.car,
      image: order.car.image ? { ...order.car.image } : undefined,
    },
    contactInfo: { ...order.contactInfo },
    cardInfo: order.cardInfo ? { ...order.cardInfo } : undefined,
    financingInfo: order.financingInfo ? { ...order.financingInfo } : undefined,
  };
}

/**
  useStageConfirmOrder is a hook that will add this stage to the state machine. It is responsible for:
  - Confirming the order of the user.
  - Storing the order in the global state.
  - Optionally, can decide to move to the next stage, getContactInfo, based on the user's responses.
*/
export function useStageConfirmOrder() {
  const {
    setOrders,
    stage,
    setStage,
    setSelectedCar,
    setContactInfo,
    setCardInfo,
    setFinancingInfo,
    selectedCar,
    contactInfo,
    cardInfo,
    financingInfo,
  } = useGlobalState();
  const orderSnapshots = useRef(new Map<string, Order>());
  const currentOrder = createOrderConfirmation({
    car: selectedCar,
    contactInfo,
    cardInfo,
    financingInfo,
  });

  // Conditionally add the nextState action to the state machine. Agent will decide if it should be called.
  useFrontendTool(
    {
      name: "nextState",
      description: "Proceed to next state",
      available: stage === "confirmOrder",
      parameters: z.object({}),
      handler: async () => {
        setSelectedCar(null);
        setContactInfo(null);
        setCardInfo(null);
        setFinancingInfo(null);
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
      render: ({ status, respond, toolCallId }) => {
        let order = orderSnapshots.current.get(toolCallId) ?? null;
        if (!order && currentOrder) {
          order = snapshotOrder(currentOrder);
          orderSnapshots.current.set(toolCallId, order);
        }

        return (
          <ConfirmOrder
            order={order}
            status={status}
            onConfirm={async (confirmedOrder: Order) => {
              if (!respond) return;

              // Let the agent know that the user has confirmed their order.
              await respond(
                "User confirmed their order, please ask them if they would like to place another order and if they do, call the 'nextState' action.",
              );

              // Commit the order only after the response succeeds.
              setOrders((prevOrders) => [...prevOrders, confirmedOrder]);
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
