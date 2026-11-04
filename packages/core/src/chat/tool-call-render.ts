/**
 * What a tool-call renderer receives: the call's status, its parsed
 * arguments, and its result.
 *
 * React, Vue, and Angular build their renderer props with these functions,
 * so a call shows the same status and arguments in every framework.
 */
import type { Message, ToolCall, ToolMessage } from "@ag-ui/core";
import { contentToText } from "@ag-ui/core";
import { DEFAULT_AGENT_ID, partialJSONParse } from "@copilotkit/shared";
import { ToolCallStatus } from "../types";
import type { CopilotChatLabels } from "./labels";

/**
 * The status of a tool call:
 *
 * - `Complete` when its result is in the messages.
 * - `Executing` while its frontend handler runs (see
 *   `CopilotKitCore.executingToolCallIds`).
 * - `InProgress` otherwise: the agent is still streaming its arguments, or
 *   the call has no frontend handler and no result yet.
 *
 * @param state - Whether the call has a result and whether it is executing.
 */
export function ɵgetToolCallStatus(state: {
  hasResult: boolean;
  isExecuting: boolean;
}) {
  if (state.hasResult) return ToolCallStatus.Complete;
  if (state.isExecuting) return ToolCallStatus.Executing;
  return ToolCallStatus.InProgress;
}

/**
 * The tool message that answers a call, if there is one.
 *
 * @param messages - The messages to search.
 * @param toolCallId - The id of the call.
 */
export function ɵfindToolMessage(
  messages: readonly Message[],
  toolCallId: string,
) {
  return messages.find(
    (message): message is ToolMessage =>
      message.role === "tool" && message.toolCallId === toolCallId,
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Parse a tool call's arguments for a renderer.
 *
 * While the arguments may still be streaming (`partial: true`), they are
 * parsed as partial JSON, and anything that is not an object yet reads `{}`.
 * Once they are complete, they are parsed as strict JSON, and a renderer
 * still gets an object for bad input: a non-object value reads
 * `{ _value: value }`, and text that is not JSON reads `{ _raw: text }`.
 *
 * @param rawArguments - The call's `function.arguments` string.
 * @param options - `partial`: the arguments may still be streaming.
 */
export function ɵparseToolCallArguments(
  rawArguments: string,
  options: { partial: boolean },
) {
  if (options.partial) {
    const partial: Record<string, unknown> = partialJSONParse(rawArguments);
    return partial;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawArguments);
  } catch {
    const raw: Record<string, unknown> = { _raw: rawArguments };
    return raw;
  }
  const args: Record<string, unknown> = isPlainObject(parsed)
    ? parsed
    : { _value: parsed };
  return args;
}

/**
 * Everything a tool-call renderer needs, apart from framework extras.
 *
 * The status follows {@link ɵgetToolCallStatus}. The arguments follow
 * {@link ɵparseToolCallArguments}, parsed as partial JSON only while the
 * call is `InProgress`. The result is the text of the tool message (content
 * parts that are not text are left out, because renderers get a string).
 *
 * @param toolCall - The call to draw.
 * @param toolMessage - The message with its result, if it has one. See
 *   {@link ɵfindToolMessage}.
 * @param options - `isExecuting`: the call's handler runs now.
 *
 * @example
 * ```ts
 * const props = ɵbuildToolCallRenderProps(
 *   toolCall,
 *   ɵfindToolMessage(messages, toolCall.id),
 *   { isExecuting: core.executingToolCallIds.has(toolCall.id) },
 * );
 * ```
 */
export function ɵbuildToolCallRenderProps(
  toolCall: ToolCall,
  toolMessage: ToolMessage | undefined,
  options: { isExecuting: boolean },
) {
  const status = ɵgetToolCallStatus({
    hasResult: toolMessage !== undefined,
    isExecuting: options.isExecuting,
  });
  const base = {
    name: toolCall.function.name,
    toolCallId: toolCall.id,
    args: ɵparseToolCallArguments(toolCall.function.arguments, {
      partial: status === ToolCallStatus.InProgress,
    }),
  };
  if (toolMessage !== undefined) {
    return {
      ...base,
      status: ToolCallStatus.Complete,
      // AG-UI 1.0 lets a tool result carry content parts. Renderers get a
      // string, so they get the text parts; the message keeps the media.
      result: contentToText(toolMessage.content),
    } as const;
  }
  if (status === ToolCallStatus.Executing) {
    return { ...base, status, result: undefined } as const;
  }
  return {
    ...base,
    status: ToolCallStatus.InProgress,
    result: undefined,
  } as const;
}

/**
 * The agent to look up tool-call renderers for: the chat's agent, else the
 * agent that wrote the message, else the default agent.
 *
 * @param chatAgentId - The agent the chat is configured for, if any.
 * @param messageAgentId - The `agentId` on the assistant message, if any.
 */
export function ɵresolveToolCallAgentId(
  chatAgentId: string | undefined,
  messageAgentId: string | undefined,
) {
  return chatAgentId ?? messageAgentId ?? DEFAULT_AGENT_ID;
}

/**
 * Development warnings for tool calls that no renderer draws. Each warning
 * names the tool and the renderers that are registered, which is the whole
 * diagnosis when the cause is a name that does not match.
 *
 * A name is skipped when a renderer for it (or a `"*"` renderer) is in
 * `registered`, so call this with the registry as it stands when you report,
 * not as it stood during render.
 *
 * @param toolNames - The tool names that rendered nothing.
 * @param registered - The registered tool-call renderers.
 * @returns One `{ toolName, message }` per distinct name that still has no
 *   renderer.
 */
export function ɵdescribeUnrenderedToolCalls(
  toolNames: readonly string[],
  registered: readonly { readonly name: string }[],
) {
  const registeredNames = [...new Set(registered.map(({ name }) => name))];
  if (registeredNames.includes("*")) return [];

  const quoted = registeredNames.map((name) => `"${name}"`).join(", ");
  const registry =
    registeredNames.length === 0
      ? "No tool-call renderers are registered. "
      : `Registered renderers: ${quoted}. `;
  const unmatched = [...new Set(toolNames)].filter(
    (name) => !registeredNames.includes(name),
  );
  return unmatched.map((toolName) => ({
    toolName,
    message:
      `[CopilotKit] The agent called the tool "${toolName}", and no renderer is ` +
      `registered for it, so that message rendered nothing. ` +
      registry +
      `Register one with useRenderTool({ name: "${toolName}", ... }), or call ` +
      `useDefaultRenderTool() for a built-in card that covers every tool the ` +
      `agent calls. This warning is development-only.`,
  }));
}

/**
 * The status a tool-call card shows. `"unknown"` is a status this version
 * does not know, as a newer runtime could send.
 */
export type ɵToolCallCardStatus =
  | "inProgress"
  | "executing"
  | "complete"
  | "unknown";

/**
 * Read a tool-call status from any framework's spelling: core's
 * `ToolCallStatus` values (`"inProgress"`, `"executing"`, `"complete"`) or
 * Angular's `"in-progress"`. Anything else is `"unknown"`.
 *
 * @param status - The status to read.
 */
export function ɵnormalizeToolCallStatus(status: string) {
  switch (status) {
    case "inProgress":
    case "in-progress":
      return "inProgress" satisfies ɵToolCallCardStatus;
    case "executing":
    case "complete":
      return status satisfies ɵToolCallCardStatus;
    default:
      return "unknown" satisfies ɵToolCallCardStatus;
  }
}

/**
 * How the built-in tool-call card shows a status: the color of its dot and
 * badge (`tone`), and the chat label for its text (`labelKey`).
 *
 * @param status - The status, from {@link ɵnormalizeToolCallStatus}.
 *
 * @example
 * ```ts
 * const { tone, labelKey } = ɵgetToolCallBadge(ɵnormalizeToolCallStatus(status));
 * badge.className = `cpk-default-tool-call-badge-${tone}`;
 * badge.textContent = labels[labelKey];
 * ```
 */
export function ɵgetToolCallBadge(status: ɵToolCallCardStatus) {
  switch (status) {
    case "inProgress":
    case "executing":
      return {
        tone: "running",
        labelKey: "toolCallStatusRunningLabel",
      } satisfies ToolCallBadge;
    case "complete":
      return {
        tone: "done",
        labelKey: "toolCallStatusDoneLabel",
      } satisfies ToolCallBadge;
    case "unknown":
      return {
        tone: "other",
        labelKey: "toolCallStatusUnknownLabel",
      } satisfies ToolCallBadge;
  }
}

interface ToolCallBadge {
  tone: "running" | "done" | "other";
  labelKey: keyof CopilotChatLabels;
}

/**
 * The description of a tool that shows a component in the chat
 * (`useComponent`, `registerComponent`), so the model reads the same text
 * whichever framework registered it.
 *
 * @param name - The tool (and component) name.
 * @param description - Extra text from the app, added after a blank line.
 */
export function ɵcomponentToolDescription(name: string, description?: string) {
  const prefix = `Use this tool to display the "${name}" component in the chat. This tool renders a visual UI component for the user.`;
  return description ? `${prefix}\n\n${description}` : prefix;
}

/**
 * What the default (`"*"`) tool-call renderer gets: the documented shape of
 * `useDefaultRenderTool`'s `render`, in React and Vue.
 */
export interface ɵDefaultToolCallRenderProps {
  /** The name of the tool being called. */
  name: string;
  /** The id of the tool call being rendered. */
  toolCallId: string;
  /** The parsed parameters passed to the tool call. */
  parameters: unknown;
  /** Current execution status of the tool call. */
  status: "inProgress" | "executing" | "complete";
  /** The tool call result string, available only when `status` is `"complete"`. */
  result: string | undefined;
}

/**
 * What a framework calls a registered `"*"` renderer with: core's raw shape
 * (`args` and a `ToolCallStatus`), or the documented shape when a call site
 * already adapted it.
 */
export interface ɵRawToolCallRenderProps {
  name?: unknown;
  toolCallId?: unknown;
  args?: unknown;
  parameters?: unknown;
  status?: unknown;
  result?: unknown;
}

// Unknown statuses already warned about, so a stuck status does not log on
// every render.
const warnedUnknownStatuses = new Set<string>();

/**
 * The status the default tool-call renderer shows. A status this version
 * does not know (a newer runtime could send one) reads `"inProgress"`, and
 * logs one warning per distinct value.
 *
 * @param status - A `ToolCallStatus`, or any framework's spelling of one.
 */
export function ɵtoDefaultToolCallStatus(
  status: unknown,
): ɵDefaultToolCallRenderProps["status"] {
  const key = String(status);
  const normalized = ɵnormalizeToolCallStatus(key);
  if (normalized !== "unknown") return normalized;
  if (!warnedUnknownStatuses.has(key)) {
    warnedUnknownStatuses.add(key);
    console.warn(
      `[CopilotKit] Unknown ToolCallStatus "${key}" in default tool-call renderer; falling back to "inProgress".`,
    );
  }
  return "inProgress";
}

/**
 * Turns the props a `"*"` renderer is called with into the documented
 * {@link ɵDefaultToolCallRenderProps}: `args` becomes `parameters`, and the
 * status goes through {@link ɵtoDefaultToolCallStatus}. Props already in the
 * documented shape stay as they are.
 *
 * @param raw - The props the renderer was called with.
 */
export function ɵadaptDefaultToolCallRenderProps(
  raw: ɵRawToolCallRenderProps,
): ɵDefaultToolCallRenderProps {
  return {
    name: raw.name as string,
    toolCallId: raw.toolCallId as string,
    parameters: raw.parameters !== undefined ? raw.parameters : raw.args,
    status: ɵtoDefaultToolCallStatus(raw.status),
    result: raw.result as string | undefined,
  };
}
