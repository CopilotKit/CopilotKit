import { HttpAgent, type HttpAgentConfig } from "@ag-ui/client";
import type { Context, RunAgentInput } from "@ag-ui/core";

export interface ContextHttpAgentOptions {
  /**
   * Supplies forwarded props that are merged into every run. Props passed to
   * an individual run take precedence on conflicts.
   */
  forwardedProps?: () => Record<string, unknown>;
  /**
   * Supplies persistent context entries that are attached to every run.
   * Entries whose description also appears in the run's own context are
   * replaced by the run's entry.
   */
  context?: () => readonly Context[];
  /**
   * If `true`, each request transmits only the messages that have not been
   * sent before, assuming the server keeps the conversation history for the
   * thread. All messages of a run count as sent once the run is finalized.
   * Call {@link ContextHttpAgent.clearSentHistory} when the server-side
   * session is reset.
   */
  useServerMemory?: boolean;
}

/**
 * An `HttpAgent` that attaches application-level state to every run.
 *
 * `HttpAgent` only sends what a single `runAgent` call passes in. App-wide
 * concerns — the signed-in user, feature flags, an A2UI catalog descriptor —
 * would have to be threaded through every call site. `ContextHttpAgent`
 * instead accepts callbacks that are evaluated per request, so persistent
 * context and forwarded props are always current without touching callers.
 * With `useServerMemory`, it additionally sends each message only once and
 * lets the server own the conversation history.
 */
export class ContextHttpAgent extends HttpAgent {
  private readonly sentMessageIds = new Set<string>();

  constructor(
    config: HttpAgentConfig,
    private readonly options: ContextHttpAgentOptions = {},
  ) {
    super(config);
    if (options.useServerMemory) {
      this.subscribe({
        onRunFinalized: () => this.markAllSent(),
      });
    }
  }

  protected override requestInit(input: RunAgentInput): RequestInit {
    let messages = input.messages;
    if (this.options.useServerMemory) {
      messages = messages.filter(
        (message) => !this.sentMessageIds.has(message.id),
      );
      this.markAllSent(input.messages);
    }

    const forwardedProps = {
      ...this.options.forwardedProps?.(),
      ...input.forwardedProps,
    };
    const context = mergePersistentContext(
      this.options.context?.() ?? [],
      input.context,
    );

    return super.requestInit({ ...input, messages, forwardedProps, context });
  }

  /**
   * Forgets which messages were already transmitted, so the next request
   * sends the full local history again. Call this when the server-side
   * session backing `useServerMemory` is reset.
   */
  clearSentHistory(): void {
    this.sentMessageIds.clear();
  }

  private markAllSent(
    messages: readonly { id: string }[] = this.messages,
  ): void {
    for (const message of messages) {
      this.sentMessageIds.add(message.id);
    }
  }
}

function mergePersistentContext(
  persistent: readonly Context[],
  incoming: readonly Context[] = [],
): Context[] {
  const present = new Set(incoming.map((entry) => entry.description));
  return [
    ...persistent.filter((entry) => !present.has(entry.description)),
    ...incoming,
  ];
}
