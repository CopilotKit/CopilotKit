import type {
  Car,
  CardInfo,
  ContactInfo,
  FinancingInfo,
  Order,
} from "@/lib/types";

type SelectedPayment =
  | { paymentType: "card"; cardInfo: CardInfo }
  | { paymentType: "financing"; financingInfo: FinancingInfo };

type ConfirmableOrder = Pick<Order, "car" | "contactInfo"> & SelectedPayment;

/** Select the payment fields included in an order confirmation. */
export function selectPaymentDetails(
  cardInfo: CardInfo | null,
  financingInfo: FinancingInfo | null,
): SelectedPayment | null {
  if (cardInfo) return { paymentType: "card", cardInfo };
  if (financingInfo) return { paymentType: "financing", financingInfo };
  return null;
}

interface OrderDraft {
  car: Car | null;
  contactInfo: ContactInfo | null;
  cardInfo: CardInfo | null;
  financingInfo: FinancingInfo | null;
}

/** Build a valid confirmation payload when every required order field exists. */
export function createOrderConfirmation({
  car,
  contactInfo,
  cardInfo,
  financingInfo,
}: OrderDraft): ConfirmableOrder | null {
  const payment = selectPaymentDetails(cardInfo, financingInfo);
  if (!car || !contactInfo || !payment) return null;

  return { car, contactInfo, ...payment };
}
