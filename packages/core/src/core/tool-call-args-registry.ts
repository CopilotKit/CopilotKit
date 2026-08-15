import type { AbstractAgent } from "@ag-ui/client";
import type { Message } from "@ag-ui/core";

/**
 * Tracks the authoritative, fully-accumulated arguments for each tool call
 * observed via AG-UI `TOOL_CALL_ARGS` events.
 *
 * Backends with an `args_streamer` re-emit enriched arguments after the LLM's
 * initial (hallucinated) values. The accumulated event data is authoritative
 * per the AG-UI protocol, but a later `MESSAGES_SNAPSHOT` — still carrying the
 * raw LLM values — replaces `agent.messages` wholesale in `@ag-ui/client`,
 * regressing the arguments that `render` and tool `handler`s consume.
 * This registry keeps the authoritative values so messages can be re-corrected
 * after each snapshot (see {@link ToolCallArgsManager}).
 */
export class ToolCallArgsRegistry {
  private entries = new Map<string, string>();

  /**
   * Record the accumulated arguments observed for a tool call so far.
   *
   * Only fully-formed JSON is accepted: mid-stream partial buffers are never
   * authoritative (a regressing snapshot always follows a complete stream),
   * and accepting them would let a corrupted buffer (e.g. a backend that
   * concatenates the LLM's delta with the streamer's replacement) become the
   * corrected value.
   */
  record(toolCallId: string, accumulatedArgs: string): void {
    if (!this.isCompleteJson(accumulatedArgs)) {
      return;
    }
    this.entries.set(toolCallId, accumulatedArgs);
  }

  /** The last accumulated arguments for a tool call, if observed. */
  get(toolCallId: string): string | undefined {
    return this.entries.get(toolCallId);
  }

  /** Number of recorded tool calls. Lets consumers skip work when empty. */
  get size(): number {
    return this.entries.size;
  }

  /** Drop all recorded entries (used when an agent is unsubscribed). */
  clear(): void {
    this.entries.clear();
  }

  private isCompleteJson(value: string): boolean {
    try {
      JSON.parse(value);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Returns a corrected copy of `messages` where every tool call known to the
 * registry carries its authoritative arguments, or `null` when no correction
 * is needed (no known tool calls, or all arguments already match).
 *
 * Pure function: never mutates the input array or its messages. The `null`
 * return (rather than the input) lets callers skip a redundant
 * `setMessages` round-trip, which is what keeps the correction loop
 * self-terminating in {@link ToolCallArgsManager}.
 */
export function normalizeMessagesWithAuthoritativeArgs(
  messages: ReadonlyArray<Readonly<Message>>,
  registry: ToolCallArgsRegistry,
): Message[] | null {
  if (registry.size === 0) return null;

  let correctedAny = false;
  const result = messages.map((message) => {
    if (!("toolCalls" in message) || !message.toolCalls?.length) {
      return message;
    }
    let correctedToolCall = false;
    const toolCalls = message.toolCalls.map((toolCall) => {
      const authoritative = registry.get(toolCall.id);
      if (
        authoritative === undefined ||
        authoritative === toolCall.function.arguments
      ) {
        return toolCall;
      }
      correctedToolCall = true;
      correctedAny = true;
      return {
        ...toolCall,
        function: { ...toolCall.function, arguments: authoritative },
      };
    });
    return correctedToolCall ? { ...message, toolCalls } : message;
  });
  return correctedAny ? result : null;
}

/**
 * Owns per-agent registries and the agent subscriptions that keep
 * `agent.messages` aligned with authoritative `TOOL_CALL_ARGS` data.
 *
 * Subscribes directly via `agent.subscribe()` — the same pattern as
 * `StateManager.subscribeToAgent` — because AG-UI event callbacks such as
 * `onToolCallArgsEvent` are intentionally excluded from
 * `CopilotKitCore.subscribeToAgentWithOptions`.
 *
 * Corrections are applied from `onMessagesChanged` (which fires after each
 * message update, including snapshot replacements) via `agent.setMessages()`,
 * the public API that assigns a fresh array reference and re-notifies
 * subscribers so React bindings re-render. Subscriber mutations returned from
 * `onMessagesSnapshotEvent` cannot be used: `@ag-ui/client` applies them
 * before merging the snapshot over them.
 *
 * Two invariants worth stating explicitly:
 *
 * - **Subscription order**: subscribers are notified in registration order,
 *   and this manager subscribes when the core registers the agent — before
 *   any framework binding mounts. Framework subscribers later in the list
 *   therefore read `agent.messages` AFTER the correction has re-assigned it,
 *   in the very same notification pass. If subscription ordering ever
 *   changes upstream, UIs would briefly render the regressed args before the
 *   correction lands (a flash, not a corruption).
 *
 * - **Registry lifetime & comparison**: entries accumulate for the agent's
 *   lifetime (tool call ids are UUIDs, so thread switches cannot collide)
 *   and are dropped only on re-subscribe; growth is bounded by the session.
 *   Corrections compare argument strings exactly, so a snapshot carrying
 *   semantically-equal but differently-formatted args is rewritten once into
 *   the registry's canonical form and is a no-op from then on (idempotent).
 */
export class ToolCallArgsManager {
  private agentSubscriptions = new Map<string, () => void>();
  private registries = new Map<string, ToolCallArgsRegistry>();

  /**
   * Subscribe to an agent to record authoritative tool call arguments and
   * re-correct `agent.messages` (via `agent.setMessages`) whenever a message
   * update regresses them, e.g. after a `MESSAGES_SNAPSHOT`.
   *
   * Re-subscribing the same agent replaces the previous subscription and
   * drops its recorded entries.
   */
  subscribeToAgent(agent: AbstractAgent): void {
    if (!agent.agentId) {
      return;
    }
    const agentId = agent.agentId;

    // Replace any existing subscription for this agent only.
    const existingUnsubscribe = this.agentSubscriptions.get(agentId);
    if (existingUnsubscribe) {
      existingUnsubscribe();
      this.agentSubscriptions.delete(agentId);
    }
    this.registries.get(agentId)?.clear();
    const registry = new ToolCallArgsRegistry();
    this.registries.set(agentId, registry);

    const correctIfRegressed = () => {
      const corrected = normalizeMessagesWithAuthoritativeArgs(
        agent.messages,
        registry,
      );
      // When a correction applies, setMessages re-notifies onMessagesChanged
      // (asynchronously); by then the messages already match the registry, so
      // normalize returns null and the loop terminates without a guard flag.
      if (corrected) {
        agent.setMessages(corrected);
      }
    };

    const { unsubscribe } = agent.subscribe({
      onToolCallArgsEvent: ({ event, toolCallBuffer }) => {
        // @ag-ui/client notifies subscribers BEFORE appending the current
        // delta to the message, so the accumulated value is buffer + delta.
        registry.record(event.toolCallId, toolCallBuffer + event.delta);
      },
      onToolCallEndEvent: ({ event, toolCallArgs }) => {
        // END is the protocol's completion point: `toolCallArgs` is the
        // pipeline's own parse of the final buffer. Recording it pins the
        // registry to upstream's terminal truth, so the ARGS-time
        // buffer+delta reconstruction above never becomes load-bearing even
        // if the notification ordering upstream ever changes. An empty
        // object here means the parse failed upstream — keep whatever
        // complete value was observed mid-stream instead of recording "{}".
        if (toolCallArgs && Object.keys(toolCallArgs).length > 0) {
          registry.record(event.toolCallId, JSON.stringify(toolCallArgs));
        }
      },
      onMessagesChanged: correctIfRegressed,
    });
    this.agentSubscriptions.set(agentId, unsubscribe);
  }

  /**
   * The authoritative accumulated arguments for a tool call on an agent, if
   * observed. Consumed by the run handler as a fallback before parsing the
   * (possibly regressed) arguments on the message.
   */
  getAuthoritativeArgs(
    agent: AbstractAgent,
    toolCallId: string,
  ): string | undefined {
    return this.registries.get(agent.agentId ?? "")?.get(toolCallId);
  }
}
