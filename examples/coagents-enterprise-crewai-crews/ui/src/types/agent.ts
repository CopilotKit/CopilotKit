export type RunStatus = "inProgress" | "complete" | "executing";

export interface AgentState {
  inputs: {
    location: string;
  };
  result: string;
  messages: unknown[];
  tasks: Task[];
  steps: Step[];
  human_inputs: string[];
  status: "thinking" | "completed" | "error" | "human_input_requested";
}

export interface Task {
  timestamp: string;
  id: string;
  description: string;
  name: string;
  expected_output: string;
  summary: string;
  agent: string;
  output: string;
  output_json: unknown;
  kickoff_id: string;
  meta: Record<string, unknown>;
}

export interface Step {
  timestamp: string;
  id: string;
  prompt: string;
  thought: string;
  tool: string;
  tool_input: string;
  result: unknown;
  kickoff_id: string;
  meta: Record<string, unknown>;
}

export interface Feedback {
  timestamp: string;
  id: string;
  task_id: string;
  task_output: string;
  meta: Record<string, unknown>;
  /**
   * This is a client only field that is not sent to the server.
   * It is used to hold the feedback from the client.
   */
  __client_only_feedback__: any;
}
