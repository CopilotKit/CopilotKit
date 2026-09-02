/** @vitest-environment jsdom */

import { act } from "react";
import type { ComponentType, ReactNode } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { ToolCallStatus } from "@copilotkit/react-core/v2";

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

vi.mock("@/components/animated-card", () => ({
  AnimatedCard: ({ children }: { children: ReactNode }) => (
    <section>{children}</section>
  ),
}));

vi.mock("@/lib/stages", () => ({
  useGlobalState: hookMocks.useGlobalState,
}));

vi.mock("@copilotkit/react-core/v2", () => ({
  ToolCallStatus: {
    Complete: "complete",
    Executing: "executing",
    InProgress: "inProgress",
  },
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

interface ConfirmOrderRenderProps {
  name: string;
  description: string;
  toolCallId: string;
  args: Record<string, never>;
  status: ToolCallStatus.Complete;
  result: string;
  respond: undefined;
}

interface ConfirmOrderTool {
  name: string;
  render: ComponentType<ConfirmOrderRenderProps>;
}

function StageHook({ revision }: { revision: number }) {
  void revision;
  useStageConfirmOrder();
  return null;
}

describe("useStageConfirmOrder", () => {
  let cardContainer: HTMLDivElement | null;
  let cardRoot: Root | null;
  let hookContainer: HTMLDivElement;
  let hookRoot: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    cardContainer = null;
    cardRoot = null;
    hookContainer = document.createElement("div");
    document.body.append(hookContainer);
    hookRoot = createRoot(hookContainer);
  });

  afterEach(() => {
    if (cardRoot) act(() => cardRoot?.unmount());
    cardContainer?.remove();
    act(() => hookRoot.unmount());
    hookContainer.remove();
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

    act(() => hookRoot.render(<StageHook revision={0} />));

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

  test("keeps each completed confirmation bound to its original order", async () => {
    const firstCar: Car = {
      ...cars[0],
      image: cars[0].image ? { ...cars[0].image } : undefined,
    };
    const firstContact: ContactInfo = {
      name: "Ada Lovelace",
      email: "ada@example.com",
      phone: "555-0100",
    };
    const secondContact: ContactInfo = {
      name: "Grace Hopper",
      email: "grace@example.com",
      phone: "555-0101",
    };
    const state: OrderState = {
      stage: "confirmOrder",
      selectedCar: firstCar,
      contactInfo: firstContact,
      cardInfo: availableCardInfo[0],
      financingInfo: null,
      orders: [],
    };

    hookMocks.useGlobalState.mockImplementation(() => ({
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
      setOrders: vi.fn(),
    }));

    const activeCardContainer = document.createElement("div");
    cardContainer = activeCardContainer;
    document.body.append(activeCardContainer);
    cardRoot = createRoot(activeCardContainer);

    const renderHook = (revision: number) => {
      act(() => hookRoot.render(<StageHook revision={revision} />));
      const tool = hookMocks.useHumanInTheLoop.mock.calls.at(-1)?.[0] as
        | ConfirmOrderTool
        | undefined;
      if (!tool) throw new Error("confirmOrder tool was not registered");
      return tool.render;
    };
    const renderCard = (
      Renderer: ComponentType<ConfirmOrderRenderProps>,
      toolCallId: string,
    ) => {
      act(() =>
        cardRoot?.render(
          <Renderer
            name="confirmOrder"
            description="Confirm the order of the user"
            toolCallId={toolCallId}
            args={{}}
            status={ToolCallStatus.Complete}
            result="User confirmed their order"
            respond={undefined}
          />,
        ),
      );
      return activeCardContainer.textContent;
    };

    const firstRenderer = renderHook(0);
    expect(renderCard(firstRenderer, "order-1")).toContain("2025 Hyundai Kona");
    expect(cardContainer.textContent).toContain("Ada Lovelace");

    firstCar.model = "Changed after confirmation";
    firstContact.name = "Changed after confirmation";
    const nextStateTool = hookMocks.useFrontendTool.mock.calls.find(
      ([config]) => config.name === "nextState",
    )?.[0];
    if (!nextStateTool) throw new Error("nextState tool was not registered");
    await nextStateTool.handler();

    const resetRenderer = renderHook(1);
    expect(renderCard(resetRenderer, "order-1")).toContain("2025 Hyundai Kona");
    expect(cardContainer.textContent).toContain("Ada Lovelace");

    state.stage = "confirmOrder";
    state.selectedCar = cars[1];
    state.contactInfo = secondContact;
    state.cardInfo = availableCardInfo[1];
    const secondRenderer = renderHook(2);

    expect(renderCard(secondRenderer, "order-1")).toContain(
      "2025 Hyundai Kona",
    );
    expect(cardContainer.textContent).toContain("Ada Lovelace");
    expect(renderCard(secondRenderer, "order-2")).toContain("2025 Kia Tasman");
    expect(cardContainer.textContent).toContain("Grace Hopper");
  });
});
