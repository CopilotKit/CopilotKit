import type { Message, RunAgentInput } from "@ag-ui/client";
import {
  GENERATIVE_UI_ACTIVITY_TYPE,
  readCopilotKitUIEnvelope,
} from "@copilotkit/shared";
import { isRecord } from "../../agent/converters/usage";

/**
 * The A2UI v0.9 user action, as the v0.9 client sent it in
 * `forwardedProps.a2uiAction.userAction`. `@ag-ui/a2ui-middleware`,
 * `@ag-ui/a2a` and the CopilotKit runtimes in other languages read this shape.
 */
interface A2UIV09UserAction {
  name: string;
  surfaceId: string;
  sourceComponentId: string;
  context: Record<string, unknown>;
  timestamp: string;
}

export interface DowngradeA2UIV09ActionOptions {
  /**
   * The A2UI version the agent speaks. Used only when `input.messages` has
   * no `generative-ui-surface` activity message for the clicked surface.
   */
  agentVersion?: "0.9" | "1.0";
}

/** The 1.0 action of the user event that started the run, if one did. */
function readAction(forwardedProps: unknown): A2UIV09UserAction | undefined {
  const envelope = readCopilotKitUIEnvelope(forwardedProps);
  const message: unknown = envelope?.metadata.extensions.copilotkit_action;
  if (!isRecord(message) || !isRecord(message.action)) return undefined;
  const { name, surfaceId, sourceComponentId, context, timestamp } =
    message.action;
  if (typeof name !== "string" || typeof surfaceId !== "string") {
    return undefined;
  }
  return {
    name,
    surfaceId,
    sourceComponentId:
      typeof sourceComponentId === "string" ? sourceComponentId : "",
    context: isRecord(context) ? context : {},
    timestamp:
      typeof timestamp === "string" ? timestamp : new Date().toISOString(),
  };
}

/**
 * True when the surface was converted from A2UI v0.9. The last
 * `generative-ui-surface` activity message of the surface decides. With no
 * such message, `agentVersion` decides.
 */
function isV09Surface(
  messages: readonly Message[],
  surfaceId: string,
  agentVersion: DowngradeA2UIV09ActionOptions["agentVersion"],
) {
  const surface = messages.findLast(
    (message) =>
      message.role === "activity" &&
      message.activityType === GENERATIVE_UI_ACTIVITY_TYPE &&
      isRecord(message.content) &&
      message.content.surfaceId === surfaceId,
  );
  if (!surface) return agentVersion === "0.9";
  // `a2uiSourceVersion` is set by the runtime on surfaces it converted from
  // v0.9. Read it untyped: not every surface content has it.
  const content = (surface as { content?: { a2uiSourceVersion?: unknown } })
    .content;
  return content?.a2uiSourceVersion === "0.9";
}

/**
 * Removes the visible user message that the 1.0 client added for the click.
 * The client adds it just before the run, so it is the last message.
 */
function withoutActionUserMessage(messages: Message[]) {
  const last = messages.at(-1);
  if (last?.role !== "user" || typeof last.content !== "string") {
    return messages;
  }
  return messages.slice(0, -1);
}

/**
 * Turns a click on a surface that the runtime converted from A2UI v0.9 into
 * the v0.9 action that the agent side expects.
 *
 * The 1.0 client sends a click as a visible user message plus
 * `forwardedProps.copilotkit.ui.metadata.extensions.copilotkit_action`. A v0.9
 * agent stack reads `forwardedProps.a2uiAction.userAction` instead. When the
 * run carries a 1.0 action for a surface of v0.9 origin, this returns a new
 * input with `forwardedProps.a2uiAction` set and the visible user message
 * removed. Otherwise it returns `input` unchanged. It never mutates `input`.
 *
 * The visible user message is removed because the v0.9 consumers already
 * turn `a2uiAction` into what the agent sees:
 * - `@ag-ui/a2ui-middleware` (and the Python, Go, Ruby and .NET runtimes)
 *   append a synthetic `log_a2ui_event` tool call and result to the
 *   messages, and prompt the model to answer them when they end the
 *   conversation. With the user message kept, the model sees the click
 *   twice, and the conversation no longer ends with the tool result.
 * - `@ag-ui/a2a` attaches `a2uiAction` as a data part to the latest user
 *   message, and A2A agents read the data part first.
 * The v0.9 client sent no user message for a click, so with it removed the
 * agent gets the same input as it did from the v0.9 client. The 1.0 client
 * still shows the message in its chat.
 *
 * Origin: the last `generative-ui-surface` activity message for the
 * surface in `input.messages` decides (`a2uiSourceVersion === "0.9"`). With
 * no such message, `options.agentVersion === "0.9"` decides.
 *
 * @param input - The run input from the 1.0 client.
 * @param options - `agentVersion`: the fallback when the surface is unknown.
 *
 * @example
 * ```ts
 * const agentInput = downgradeA2UIV09Action(input, { agentVersion: "0.9" });
 * // agentInput.forwardedProps.a2uiAction.userAction:
 * // { name, surfaceId, sourceComponentId, context, timestamp }
 * ```
 */
export function downgradeA2UIV09Action(
  input: RunAgentInput,
  options: DowngradeA2UIV09ActionOptions = {},
): RunAgentInput {
  const forwardedProps: unknown = input.forwardedProps;
  // A run that already has a v0.9 action keeps it.
  if (!isRecord(forwardedProps) || forwardedProps.a2uiAction !== undefined) {
    return input;
  }
  const userAction = readAction(forwardedProps);
  if (!userAction) return input;
  if (
    !isV09Surface(input.messages, userAction.surfaceId, options.agentVersion)
  ) {
    return input;
  }
  return {
    ...input,
    messages: withoutActionUserMessage(input.messages),
    forwardedProps: { ...forwardedProps, a2uiAction: { userAction } },
  };
}
