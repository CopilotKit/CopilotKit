import type { ReactNode } from "react";
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

vi.mock("@/lib/single-submit", () => ({
  submitOnce: vi.fn(),
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

describe("ConfirmOrder payment selection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("shows and submits only card details when a card is selected", () => {
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

  test("shows and submits only financing details when financing is selected", () => {
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
});
