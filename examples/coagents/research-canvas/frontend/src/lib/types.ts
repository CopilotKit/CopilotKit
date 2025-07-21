export type Resource = {
  url: string;
  title: string;
  description: string;
};

export type AgentState = {
  model: string;
  research_question: string;
  report: string;
  resources: any[];
  logs: any[];
}