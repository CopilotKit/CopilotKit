import type { AbstractAgent, ActivityMessage, Message } from "@ag-ui/client";
import type { StandardSchemaV1 } from "@copilotkit/shared";
import type { ToolCallStatus } from "../types";

/**
 * Props a tool call renderer receives. The `status` field tells which stage
 * the call is in:
 *
 * - `InProgress`: the agent is still streaming arguments, so `args` is partial.
 * - `Executing`: `args` is complete and the tool is running.
 * - `Complete`: the tool finished and `result` holds its output.
 *
 * @typeParam T - The shape of the tool arguments.
 */
export type ToolCallRenderProps<T = unknown> =
  | {
      name: string;
      toolCallId: string;
      args: Partial<T>;
      status: ToolCallStatus.InProgress;
      result: undefined;
    }
  | {
      name: string;
      toolCallId: string;
      args: T;
      status: ToolCallStatus.Executing;
      result: undefined;
    }
  | {
      name: string;
      toolCallId: string;
      args: T;
      status: ToolCallStatus.Complete;
      result: string;
    };

/**
 * Props a human-in-the-loop renderer receives.
 *
 * Beyond the tool call's `args`/`status`/`result`, the render props carry
 * attribution:
 * - `toolCallId`: the AG-UI tool call id, unique per interrupt. It is the
 *   stable key for correlating this interrupt with runtime (sub)agent
 *   attribution, e.g. the `agentId` reported by `onToolExecutionStart`, or
 *   per-run attribution stamped on the event stream, so the UI can label
 *   the interrupt with the agent that actually raised it.
 * - `agentId`: the agent this tool was *registered* to (the tool's own
 *   `agentId`), or `undefined` for an unscoped tool. This is the static
 *   registration scope; it is NOT necessarily the runtime (sub)agent that
 *   raised the interrupt. For runtime attribution, correlate `toolCallId`
 *   with the event-stream/`onToolExecutionStart` agent id.
 *
 * `respond` is only defined while the status is `Executing`. Call it with the
 * user's answer to send the tool result back to the agent.
 *
 * @typeParam T - The shape of the tool arguments.
 */
export type HumanInTheLoopRenderProps<T = unknown> =
  | {
      name: string;
      description: string;
      toolCallId: string;
      agentId?: string;
      args: Partial<T>;
      status: ToolCallStatus.InProgress;
      result: undefined;
      respond: undefined;
    }
  | {
      name: string;
      description: string;
      toolCallId: string;
      agentId?: string;
      args: T;
      status: ToolCallStatus.Executing;
      result: undefined;
      respond: (result: unknown) => Promise<void>;
    }
  | {
      name: string;
      description: string;
      toolCallId: string;
      agentId?: string;
      args: T;
      status: ToolCallStatus.Complete;
      result: string;
      respond: undefined;
    };

/**
 * A tool call renderer registration. Core stores and looks up renderers by
 * `name` and `agentId`. It never calls `render`, so each framework picks its
 * own render type (a React component, a Vue render function, and so on).
 *
 * @typeParam T - The shape of the tool arguments.
 * @typeParam TRender - The framework's render type.
 */
export interface ToolCallRendererDef<T = unknown, TRender = unknown> {
  /** Tool name to match. Use `"*"` for a wildcard renderer. */
  name: string;
  /**
   * Schema describing the tool arguments. Optional: renderers registered for
   * tools without parameters (e.g. HITL confirm dialogs) have no schema.
   */
  args?: StandardSchemaV1<unknown, T>;
  /**
   * Optional agent ID to constrain this tool renderer to a specific agent.
   * If specified, this renderer will only be used for the specified agent.
   */
  agentId?: string;
  /**
   * Whether calls this renderer draws join the chat's tool-call groups (see
   * `toolCallDisplay` on `CopilotChatMessageView`). CopilotKit's built-in card
   * sets it; a renderer that leaves it unset always shows its calls on their
   * own, since the chat can't tell what it draws (it may even draw nothing).
   */
  group?: boolean;
  /** Draws the tool call. Receives {@link ToolCallRenderProps}. */
  render: TRender;
}

/**
 * Props an activity message renderer receives.
 *
 * @typeParam C - The shape of the activity content.
 */
export interface ActivityMessageRenderProps<C = unknown> {
  /** Activity type of the message being drawn. */
  activityType: string;
  /** Activity content, parsed with the renderer's `content` schema. */
  content: C;
  /** The activity message being drawn. */
  message: ActivityMessage;
  /** The agent that produced the message, if it is still registered. */
  agent: AbstractAgent | undefined;
}

/**
 * An activity message renderer registration. Core never calls `render`.
 *
 * @typeParam C - The shape of the activity content.
 * @typeParam TRender - The framework's render type.
 */
export interface ActivityMessageRendererDef<C = unknown, TRender = unknown> {
  /**
   * Activity type to match when rendering. Use "*" as a wildcard renderer.
   */
  activityType: string;
  /**
   * Optional agent ID to scope the renderer to a particular agent.
   */
  agentId?: string;
  /**
   * Schema describing the activity content payload.
   */
  content: StandardSchemaV1<unknown, C>;
  /** Draws the activity message. Receives {@link ActivityMessageRenderProps}. */
  render: TRender;
}

/** Where a custom message renderer draws, relative to its message. */
export type CustomMessageRendererPosition = "before" | "after";

/** Props a custom message renderer receives. */
export interface CustomMessageRenderProps {
  /** The message this renderer draws next to. */
  message: Message;
  /** Whether the renderer draws before or after `message`. */
  position: CustomMessageRendererPosition;
  /** The run that produced `message`. */
  runId: string;
  /** Index of `message` in the whole conversation. */
  messageIndex: number;
  /** Index of `message` inside its run. */
  messageIndexInRun: number;
  /** How many messages the run produced. */
  numberOfMessagesInRun: number;
  /** The agent that owns the conversation. */
  agentId: string;
  /** Agent state captured for this run, or `undefined` when the run is unknown. */
  stateSnapshot: unknown;
}

/**
 * A custom message renderer registration. Core never calls `render`.
 *
 * @typeParam TRender - The framework's render type.
 */
export interface CustomMessageRendererDef<TRender = unknown> {
  /** Optional agent ID to scope the renderer to a particular agent. */
  agentId?: string;
  /** Draws next to a message. Receives {@link CustomMessageRenderProps}. */
  render: TRender;
}
