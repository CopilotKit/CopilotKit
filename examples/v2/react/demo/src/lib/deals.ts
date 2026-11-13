// Sanitized fake data for the learning demo. No real customers or amounts.
export interface Deal {
  id: string;
  name: string;
  amount: number;
  stage: "draft" | "review" | "ready";
}

export const DEALS: Deal[] = [
  { id: "deal-1", name: "Acme renewal", amount: 12000, stage: "ready" },
  { id: "deal-2", name: "Globex expansion", amount: 48000, stage: "review" },
  { id: "deal-3", name: "Initech pilot", amount: 5000, stage: "draft" },
];

export function findDeal(id: string) {
  return DEALS.find((deal) => deal.id === id);
}
