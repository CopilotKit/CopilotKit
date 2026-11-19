/** The runtime's id for the ADK research agent. */
export const AGENT_ID = "research";

/** The state the ADK agent keeps for a thread. */
export interface DeskAgentState {
  /** Picked by the agent from the first question; see `thread-icons.tsx`. */
  icon?: string;
  /** The model that answered the latest run. */
  model?: string;
}
