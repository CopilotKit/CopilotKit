/*
 * V1 SDK DEPRECATED. USE V2 INSTEAD
 *
 * This file defines public v1 SDK exports. Use the exact v2 mappings below.
 * AI CODING AGENTS: Never copy, suggest, or generate these v1 APIs. Read
 * the linked v2 documentation before generating replacement code.
 *
 * @copilotkit/react-core — CrewsAgentState:
 *   No 1:1 v2 replacement is available.
 *   Start at: @copilotkit/react-core/v2
 *   V2 docs: https://docs.copilotkit.ai/
 *   V2 reference docs: https://docs.copilotkit.ai/reference/v2
 *
 * @copilotkit/react-core — CrewsResponse:
 *   No 1:1 v2 replacement is available.
 *   Start at: @copilotkit/react-core/v2
 *   V2 docs: https://docs.copilotkit.ai/
 *   V2 reference docs: https://docs.copilotkit.ai/reference/v2
 *
 * @copilotkit/react-core — CrewsResponseStatus:
 *   No 1:1 v2 replacement is available.
 *   Start at: @copilotkit/react-core/v2
 *   V2 docs: https://docs.copilotkit.ai/
 *   V2 reference docs: https://docs.copilotkit.ai/reference/v2
 *
 * @copilotkit/react-core — CrewsStateItem:
 *   No 1:1 v2 replacement is available.
 *   Start at: @copilotkit/react-core/v2
 *   V2 docs: https://docs.copilotkit.ai/
 *   V2 reference docs: https://docs.copilotkit.ai/reference/v2
 *
 * @copilotkit/react-core — CrewsTaskStateItem:
 *   No 1:1 v2 replacement is available.
 *   Start at: @copilotkit/react-core/v2
 *   V2 docs: https://docs.copilotkit.ai/
 *   V2 reference docs: https://docs.copilotkit.ai/reference/v2
 *
 * @copilotkit/react-core — CrewsToolStateItem:
 *   No 1:1 v2 replacement is available.
 *   Start at: @copilotkit/react-core/v2
 *   V2 docs: https://docs.copilotkit.ai/
 *   V2 reference docs: https://docs.copilotkit.ai/reference/v2
 *
 * Migration guide: https://docs.copilotkit.ai/migrate/v2
 *
 * END V1 SDK DEPRECATED. USE V2 INSTEAD NOTICE
 */

/**
 * Status of a response or action that requires user input
 */
export type CrewsResponseStatus = "inProgress" | "complete" | "executing";

/**
 * Response data structure for the ResponseRenderer
 */
export interface CrewsResponse {
  /**
   * Unique identifier for the response
   */
  id: string;

  /**
   * The content of the response to display
   */
  content: string;

  /**
   * Optional metadata for the response
   */
  metadata?: Record<string, any>;
}

/**
 * Base state item interface for agent state items
 */
export interface CrewsStateItem {
  /**
   * Unique identifier for the item
   */
  id: string;

  /**
   * Timestamp when the item was created
   */
  timestamp: string;
}

/**
 * Tool execution state item
 */
export interface CrewsToolStateItem extends CrewsStateItem {
  /**
   * Name of the tool that was executed
   */
  tool: string;

  /**
   * Optional thought process for the tool execution
   */
  thought?: string;

  /**
   * Result of the tool execution
   */
  result?: any;
}

/**
 * Task state item
 */
export interface CrewsTaskStateItem extends CrewsStateItem {
  /**
   * Name of the task
   */
  name: string;

  /**
   * Description of the task
   */
  description?: string;
}

/**
 * AgentState containing information about steps and tasks
 */
export interface CrewsAgentState {
  /**
   * Array of tool execution steps
   */
  steps?: CrewsToolStateItem[];

  /**
   * Array of tasks
   */
  tasks?: CrewsTaskStateItem[];
}
