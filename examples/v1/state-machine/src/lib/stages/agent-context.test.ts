import { describe, expect, test } from "vitest";
import { createAgentContextValue } from "./agent-context";
import { availableCardInfo } from "../types/payment-info";

describe("createAgentContextValue", () => {
  test("exposes only masked card summaries to the agent", () => {
    const currentCard = {
      ...availableCardInfo[0],
      cardNumber: "1111-2222-3333-4444",
      cardCvv: "current-cvv",
    };
    const orderCard = {
      ...availableCardInfo[1],
      cardNumber: "5555-6666-7777-8888",
      cardCvv: "order-cvv",
    };

    const context = createAgentContextValue({
      contactInfo: null,
      selectedCar: null,
      cardInfo: currentCard,
      financingInfo: null,
      orders: [
        {
          car: {},
          contactInfo: {
            name: "Test Customer",
            email: "customer@example.com",
            phone: "555-0100",
          },
          cardInfo: orderCard,
          paymentType: "card",
        },
      ],
      currentStage: "confirmOrder",
    });

    expect(context.cardInfo).toEqual({
      type: currentCard.type,
      lastFourDigits: "4444",
    });
    expect(context.orders[0].cardInfo).toEqual({
      type: orderCard.type,
      lastFourDigits: "8888",
    });

    const serializedContext = JSON.stringify(context);
    expect(serializedContext).not.toContain(currentCard.cardNumber);
    expect(serializedContext).not.toContain(currentCard.cardCvv);
    expect(serializedContext).not.toContain(orderCard.cardNumber);
    expect(serializedContext).not.toContain(orderCard.cardCvv);
  });
});
