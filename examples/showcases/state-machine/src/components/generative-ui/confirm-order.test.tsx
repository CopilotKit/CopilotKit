/** @vitest-environment jsdom */

import { act } from "react";
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { ToolCallStatus } from "@copilotkit/react-core/v2";
import { cars } from "../../lib/types/cars";
import type { ContactInfo } from "../../lib/types/contact-info";
import type { FinancingInfo } from "../../lib/types/financing-info";
import { availableCardInfo } from "../../lib/types/payment-info";

vi.mock("@/components/animated-card", () => ({
  AnimatedCard: ({ children }: { children: ReactNode }) => (
    <section>{children}</section>
  ),
}));

vi.mock("@copilotkit/react-core/v2", () => ({
  ToolCallStatus: {
    Complete: "complete",
    Executing: "executing",
  },
}));

import { ConfirmOrder } from "./confirm-order";
import { createOrderConfirmation } from "./selected-payment";

const contactInfo: ContactInfo = {
  name: "Ada Lovelace",
  email: "ada@example.com",
  phone: "555-0100",
};
const cardInfo = availableCardInfo[0];
const financingInfo: FinancingInfo = {
  creditScore: "760",
  loanTerm: "60",
};

function renderSummary(payment: {
  cardInfo: typeof cardInfo | null;
  financingInfo: FinancingInfo | null;
}): string {
  const order = createOrderConfirmation({
    car: cars[0],
    contactInfo,
    ...payment,
  });

  return renderToStaticMarkup(
    <ConfirmOrder
      order={order}
      status={ToolCallStatus.Complete}
      onConfirm={vi.fn()}
      onCancel={vi.fn()}
    />,
  );
}

async function submitOrder(
  order: NonNullable<ReturnType<typeof createOrderConfirmation>>,
) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const onConfirm = vi.fn();

  await act(async () => {
    root.render(
      <ConfirmOrder
        order={order}
        status={ToolCallStatus.Executing}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );
  });

  const button = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent === "Confirm Order",
  );
  if (!button) throw new Error("Confirm Order button was not rendered");

  await act(async () => {
    button.click();
  });
  act(() => root.unmount());
  container.remove();

  return onConfirm;
}

describe("ConfirmOrder payment selection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("shows and builds only card details when a card is selected", () => {
    const order = createOrderConfirmation({
      car: cars[0],
      contactInfo,
      cardInfo,
      financingInfo,
    });
    const markup = renderSummary({ cardInfo, financingInfo });

    expect(markup).toContain(">Payment<");
    expect(markup).toContain("****3456");
    expect(markup).not.toContain(">Financing<");
    expect(markup).not.toContain("60 months");
    expect(order).toEqual({
      car: cars[0],
      contactInfo,
      paymentType: "card",
      cardInfo,
    });
  });

  test("shows and builds only financing details when financing is selected", () => {
    const order = createOrderConfirmation({
      car: cars[0],
      contactInfo,
      cardInfo: null,
      financingInfo,
    });
    const markup = renderSummary({ cardInfo: null, financingInfo });

    expect(markup).toContain(">Financing<");
    expect(markup).toContain("60 months");
    expect(markup).not.toContain(">Payment<");
    expect(markup).not.toContain("****");
    expect(order).toEqual({
      car: cars[0],
      contactInfo,
      paymentType: "financing",
      financingInfo,
    });
  });

  test("submits the exact card order from the executing action", async () => {
    const order = createOrderConfirmation({
      car: cars[0],
      contactInfo,
      cardInfo,
      financingInfo,
    });
    if (!order) throw new Error("card order was not created");

    const onConfirm = await submitOrder(order);

    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onConfirm).toHaveBeenCalledWith(order);
    expect(onConfirm.mock.calls[0]?.[0]).toEqual({
      car: cars[0],
      contactInfo,
      paymentType: "card",
      cardInfo,
    });
  });

  test("submits the exact financing order from the executing action", async () => {
    const order = createOrderConfirmation({
      car: cars[0],
      contactInfo,
      cardInfo: null,
      financingInfo,
    });
    if (!order) throw new Error("financing order was not created");

    const onConfirm = await submitOrder(order);

    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onConfirm).toHaveBeenCalledWith(order);
    expect(onConfirm.mock.calls[0]?.[0]).toEqual({
      car: cars[0],
      contactInfo,
      paymentType: "financing",
      financingInfo,
    });
  });
});
