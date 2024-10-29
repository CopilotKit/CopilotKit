export type AgentState = {
  model: string;
  steps: any[];
  answer: {
    markdown: string;
    references: any[];
  };
}