import type {
  Car,
  CardInfo,
  ContactInfo,
  FinancingInfo,
  Order,
} from "@/lib/types";
import type { Stage } from "@/lib/system-prompt";

interface AgentContextValue {
  contactInfo: ContactInfo | null;
  selectedCar: Car | null;
  cardInfo: CardInfo | null;
  financingInfo: FinancingInfo | null;
  orders: readonly Order[];
  currentStage: Stage;
}

function summarizeCardInfo(cardInfo: CardInfo | null | undefined) {
  if (!cardInfo) {
    return null;
  }

  const digits = cardInfo.cardNumber.replace(/\D/g, "");

  return {
    type: cardInfo.type,
    lastFourDigits: digits.length > 4 ? digits.slice(-4) : null,
  };
}

export function createAgentContextValue({
  contactInfo,
  selectedCar,
  cardInfo,
  financingInfo,
  orders,
  currentStage,
}: AgentContextValue) {
  return {
    contactInfo,
    selectedCar,
    cardInfo: summarizeCardInfo(cardInfo),
    financingInfo,
    orders: orders.map(({ cardInfo: orderCardInfo, ...order }) => ({
      ...order,
      cardInfo: summarizeCardInfo(orderCardInfo),
    })),
    currentStage,
  };
}
