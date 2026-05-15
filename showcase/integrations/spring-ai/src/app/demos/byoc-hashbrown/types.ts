/**
 * Local types for the byoc-hashbrown demo on Spring AI.
 *
 * Mirrors the langgraph-python variant — domain types the hashbrown
 * renderer's DealCard needs.
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
