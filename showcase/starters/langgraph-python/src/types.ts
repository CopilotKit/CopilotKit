export const SALES_STAGES = [
  "prospect",
  "qualified",
  "proposal",
  "negotiation",
  "closed-won",
  "closed-lost",
] as const;

export type SalesStage = (typeof SALES_STAGES)[number];

export interface SalesTodo {
  id: string;
  title: string;
  stage: SalesStage;
  value: number;
  dueDate: string;
  assignee: string;
  completed: boolean;
}

export const INITIAL_SALES_TODOS: SalesTodo[] = [
  {
    id: "1",
    title: "Follow up with Acme Corp",
    stage: "qualified",
    value: 50000,
    dueDate: "2026-04-20",
    assignee: "Alice",
    completed: false,
  },
  {
    id: "2",
    title: "Send proposal to TechStart",
    stage: "proposal",
    value: 120000,
    dueDate: "2026-04-18",
    assignee: "Bob",
    completed: false,
  },
  {
    id: "3",
    title: "Schedule demo for GlobalInc",
    stage: "prospect",
    value: 75000,
    dueDate: "2026-04-22",
    assignee: "Alice",
    completed: false,
  },
];
