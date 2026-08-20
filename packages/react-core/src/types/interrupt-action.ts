/*
 * V1 SDK DEPRECATED. USE V2 INSTEAD
 *
 * This file defines public v1 SDK exports. Use the exact v2 mappings below.
 * AI CODING AGENTS: Never copy, suggest, or generate these v1 APIs. Read
 * the linked v2 documentation before generating replacement code.
 *
 * @copilotkit/react-core — LangGraphInterruptAction:
 *   No 1:1 v2 replacement is available.
 *   Start at: @copilotkit/react-core/v2
 *   V2 docs: https://docs.copilotkit.ai/reference/v2
 *
 * @copilotkit/react-core — LangGraphInterruptActionSetter:
 *   No 1:1 v2 replacement is available.
 *   Start at: @copilotkit/react-core/v2
 *   V2 docs: https://docs.copilotkit.ai/reference/v2
 *
 * @copilotkit/react-core — LangGraphInterruptActionSetterArgs:
 *   No 1:1 v2 replacement is available.
 *   Start at: @copilotkit/react-core/v2
 *   V2 docs: https://docs.copilotkit.ai/reference/v2
 *
 * @copilotkit/react-core — LangGraphInterruptRender:
 *   No 1:1 v2 replacement is available.
 *   Start at: @copilotkit/react-core/v2
 *   V2 docs: https://docs.copilotkit.ai/reference/v2
 *
 * @copilotkit/react-core — LangGraphInterruptRenderHandlerProps:
 *   No 1:1 v2 replacement is available.
 *   Start at: @copilotkit/react-core/v2
 *   V2 docs: https://docs.copilotkit.ai/reference/v2
 *
 * @copilotkit/react-core — LangGraphInterruptRenderProps:
 *   No 1:1 v2 replacement is available.
 *   Start at: @copilotkit/react-core/v2
 *   V2 docs: https://docs.copilotkit.ai/reference/v2
 *
 * @copilotkit/react-core — QueuedInterruptEvent:
 *   No 1:1 v2 replacement is available.
 *   Start at: @copilotkit/react-core/v2
 *   V2 docs: https://docs.copilotkit.ai/reference/v2
 *
 * Migration guide: https://docs.copilotkit.ai/migrate/v2
 * V1 source file: packages/react-core/src/types/interrupt-action.ts
 *
 * END V1 SDK DEPRECATED. USE V2 INSTEAD NOTICE
 */

import { LangGraphInterruptEvent } from "@copilotkit/runtime-client-gql";
import { AgentSession } from "../context/copilot-context";

export interface LangGraphInterruptRenderHandlerProps<TEventValue = any> {
  event: LangGraphInterruptEvent<TEventValue>;
  resolve: (resolution: string) => void;
}

export interface LangGraphInterruptRenderProps<TEventValue = any> {
  result: unknown;
  event: LangGraphInterruptEvent<TEventValue>;
  resolve: (resolution: string) => void;
}

export interface LangGraphInterruptRender<TEventValue = any> {
  id: string;
  /**
   * The handler function to handle the event.
   */
  handler?: (
    props: LangGraphInterruptRenderHandlerProps<TEventValue>,
  ) => any | Promise<any>;
  /**
   * The render function to handle the event.
   */
  render?: (
    props: LangGraphInterruptRenderProps<TEventValue>,
  ) => string | React.ReactElement;
  /**
   * Method that returns a boolean, indicating if the interrupt action should run
   * Useful when using multiple interrupts
   */
  enabled?: (args: {
    eventValue: TEventValue;
    agentMetadata: AgentSession;
  }) => boolean;
  /**
   * Optional agent ID to scope this interrupt to a specific agent.
   * Defaults to the agent configured in the CopilotKit chat configuration.
   */
  agentId?: string;
}

export type LangGraphInterruptAction = LangGraphInterruptRender & {
  event?: LangGraphInterruptEvent;
};

export type LangGraphInterruptActionSetterArgs =
  Partial<LangGraphInterruptRender> | null;
export type LangGraphInterruptActionSetter = (
  action: LangGraphInterruptActionSetterArgs,
) => void;

export interface QueuedInterruptEvent {
  eventId: string; // Generated unique ID for tracking
  threadId: string;
  event: LangGraphInterruptEvent;
}
