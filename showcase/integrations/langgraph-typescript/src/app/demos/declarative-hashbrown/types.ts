/**
 * Local types for the declarative-hashbrown demo.
 *
 * Ported subset from showcase/starters/template/frontend/types.ts — only the
 * domain types the hashbrown renderer's DealCard needs.
 */
export const SALES_STAGES = [
  "prospect",
  "qualified",
  "proposal",
  "negotiation",
  "closed-won",
  "closed-lost",
] as const;

export type SalesStage = (typeof SALES_STAGES)[number];
