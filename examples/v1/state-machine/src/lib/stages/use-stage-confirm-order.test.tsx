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
  status: ToolCallStatus;
  result: string;
  respond: ((result: string) => Promise<void> | void) | undefined;
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

  function createConfirmationState(): OrderState {
    return {
      stage: "confirmOrder",
      selectedCar: cars[0],
      contactInfo: {
        name: "Ada Lovelace",
        email: "ada@example.com",
        phone: "555-0100",
      },
      cardInfo: availableCardInfo[0],
      financingInfo: null,
      orders: [],
    };
  }

  function registerConfirmationState(state: OrderState) {
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
      setOrders: (update: (orders: Order[]) => Order[]) => {
        state.orders = update(state.orders);
      },
    }));
  }

  function renderConfirmation(
    respond: ConfirmOrderRenderProps["respond"],
  ): HTMLDivElement {
    act(() => hookRoot.render(<StageHook revision={0} />));
    const tool = hookMocks.useHumanInTheLoop.mock.calls.at(-1)?.[0] as
      | ConfirmOrderTool
      | undefined;
    if (!tool) throw new Error("confirmOrder tool was not registered");

    const activeCardContainer = document.createElement("div");
    cardContainer = activeCardContainer;
    document.body.append(activeCardContainer);
    cardRoot = createRoot(activeCardContainer);
    const Renderer = tool.render;
    act(() =>
      cardRoot?.render(
        <Renderer
          name="confirmOrder"
          description="Confirm the order of the user"
          toolCallId="order-under-test"
          args={{}}
          status={ToolCallStatus.Executing}
          result=""
          respond={respond}
        />,
      ),
    );
    return activeCardContainer;
  }

  async function clickButton(container: HTMLDivElement, label: string) {
    const button = Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent === label,
    );
    if (!button) throw new Error(`${label} button was not rendered`);
    await act(async () => {
      button.click();
    });
  }

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

  test("commits a confirmed order only after the response succeeds", async () => {
    const state = createConfirmationState();
    registerConfirmationState(state);
    const respond = vi.fn().mockResolvedValue(undefined);
    const container = renderConfirmation(respond);

    await clickButton(container, "Confirm Order");

    expect(respond).toHaveBeenCalledWith(
      "User confirmed their order, please ask them if they would like to place another order and if they do, call the 'nextState' action.",
    );
    expect(state.orders).toHaveLength(1);
    expect(state.orders[0]).toMatchObject({
      car: cars[0],
      contactInfo: state.contactInfo,
      paymentType: "card",
      cardInfo: availableCardInfo[0],
    });
  });

  test("does not commit a rejected response and commits one order on retry", async () => {
    const state = createConfirmationState();
    registerConfirmationState(state);
    const respond = vi
      .fn()
      .mockRejectedValueOnce(new Error("network failure"))
      .mockResolvedValue(undefined);
    const container = renderConfirmation(respond);

    await clickButton(container, "Confirm Order");

    expect(state.orders).toEqual([]);
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "Could not send your response. Try again.",
    );

    await clickButton(container, "Retry");

    expect(respond).toHaveBeenCalledTimes(2);
    expect(state.orders).toHaveLength(1);
  });

  test("reports cancellation without committing an order", async () => {
    const state = createConfirmationState();
    registerConfirmationState(state);
    const respond = vi.fn().mockResolvedValue(undefined);
    const container = renderConfirmation(respond);

    await clickButton(container, "Cancel");

    expect(respond).toHaveBeenCalledWith(
      "User cancelled their order, please ask them if they'd like to start over with a new order or if they'd like to continue with their current order. If they'd like to start over, call the 'nextState' action. If they'd like to continue with their current order, call the 'confirmOrder' action.",
    );
    expect(state.orders).toEqual([]);
  });

  test("does not commit when the renderer has no responder", async () => {
    const state = createConfirmationState();
    registerConfirmationState(state);
    const container = renderConfirmation(undefined);

    await clickButton(container, "Confirm Order");

    expect(state.orders).toEqual([]);
  });
});
