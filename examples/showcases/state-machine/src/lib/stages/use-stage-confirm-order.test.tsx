import { beforeEach, describe, expect, test, vi } from "vitest";

import { cars } from "../types/cars";
import type { Car } from "../types/cars";
import type { ContactInfo } from "../types/contact-info";
import type { FinancingInfo } from "../types/financing-info";
import type { Order } from "../types/orders";
import { availableCardInfo } from "../types/payment-info";
import type { CardInfo } from "../types/payment-info";
import type { Stage } from "./use-global-state";

const hookMocks = vi.hoisted(() => ({
  useFrontendTool:
    vi.fn<
      (
        config: { name: string; handler: () => Promise<string> },
        dependencies: unknown[],
      ) => void
    >(),
  useGlobalState: vi.fn(),
  useHumanInTheLoop: vi.fn(),
}));

vi.mock("@/components/generative-ui/confirm-order", () => ({
  ConfirmOrder: vi.fn(),
}));

vi.mock("@/lib/stages", () => ({
  useGlobalState: hookMocks.useGlobalState,
}));

vi.mock("@copilotkit/react-core/v2", () => ({
  useFrontendTool: hookMocks.useFrontendTool,
  useHumanInTheLoop: hookMocks.useHumanInTheLoop,
}));

import { useStageConfirmOrder } from "./use-stage-confirm-order";

interface OrderState {
  stage: Stage;
  selectedCar: Car | null;
  contactInfo: ContactInfo | null;
  cardInfo: CardInfo | null;
  financingInfo: FinancingInfo | null;
  orders: Order[];
}

describe("useStageConfirmOrder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("starts a new order with an empty draft and keeps completed orders", async () => {
    const completedOrders: Order[] = [
      {
        car: cars[0],
        contactInfo: {
          name: "John Doe",
          email: "john.doe@example.com",
          phone: "1234567890",
        },
        cardInfo: availableCardInfo[0],
        paymentType: "card",
      },
    ];
    const state: OrderState = {
      stage: "confirmOrder",
      selectedCar: cars[1],
      contactInfo: {
        name: "Jane Doe",
        email: "jane.doe@example.com",
        phone: "0987654321",
      },
      cardInfo: availableCardInfo[1],
      financingInfo: {
        creditScore: "760",
        loanTerm: "48",
      },
      orders: completedOrders,
    };
    const setOrders = vi.fn();

    hookMocks.useGlobalState.mockReturnValue({
      ...state,
      setStage: (stage: Stage) => {
        state.stage = stage;
      },
      setSelectedCar: (selectedCar: Car | null) => {
        state.selectedCar = selectedCar;
      },
      setContactInfo: (contactInfo: ContactInfo | null) => {
        state.contactInfo = contactInfo;
      },
      setCardInfo: (cardInfo: CardInfo | null) => {
        state.cardInfo = cardInfo;
      },
      setFinancingInfo: (financingInfo: FinancingInfo | null) => {
        state.financingInfo = financingInfo;
      },
      setOrders,
    });

    useStageConfirmOrder();

    const nextStateTool = hookMocks.useFrontendTool.mock.calls.find(
      ([config]) => config.name === "nextState",
    )?.[0];
    if (!nextStateTool) {
      throw new Error("nextState tool was not registered");
    }

    await expect(nextStateTool.handler()).resolves.toBe("Started a new order");

    expect(state).toEqual({
      stage: "getContactInfo",
      selectedCar: null,
      contactInfo: null,
      cardInfo: null,
      financingInfo: null,
      orders: completedOrders,
    });
    expect(state.orders).toBe(completedOrders);
    expect(setOrders).not.toHaveBeenCalled();
  });
});
