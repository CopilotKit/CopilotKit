import {
  DestroyRef,
  computed,
  inject,
  signal,
  type Signal,
} from "@angular/core";
import { DEFAULT_AGENT_ID } from "@copilotkit/shared";

import { COPILOT_CHAT_CONFIGURATION } from "./chat-configuration";
import { CopilotKit } from "./copilotkit";

export interface InjectSubagentsOptions {
  /** The agent to read. Defaults to the chat's agent. */
  agentId?: string | Signal<string | undefined>;
  /** The thread to read. Defaults to the chat's thread. */
  threadId?: string | Signal<string | undefined>;
}

function read(value: string | Signal<string | undefined> | undefined) {
  return typeof value === "string" ? value : value?.();
}

/**
 * Read the AG-UI subagent invocations on an agent thread, as a signal.
 *
 * Each entry has the subagent's `name`, its `status` (`running`, `done`,
 * `suspended` or `error`), and the tool call or parent subagent that started
 * it. The list is in start order and keeps its reference until it changes.
 * Call it in an injection context; it stops listening when that context is
 * destroyed.
 *
 * The agent must attribute its output to subagents (AG-UI 1.0 subagent
 * events). An agent that does not gives an empty list.
 *
 * @param options - Optional `agentId` and `threadId` (strings or signals);
 * both default to the surrounding chat configuration.
 *
 * @example
 * ```ts
 * @Component({
 *   selector: "subagent-progress",
 *   template: `
 *     @for (subagent of subagents(); track subagent.subagentRunId) {
 *       <p>{{ subagent.name }}: {{ subagent.status }}</p>
 *     }
 *   `,
 * })
 * export class SubagentProgress {
 *   readonly subagents = injectSubagents();
 * }
 * ```
 */
export function injectSubagents({
  agentId,
  threadId,
}: InjectSubagentsOptions = {}) {
  const { core } = inject(CopilotKit);
  const chatConfiguration = inject(COPILOT_CHAT_CONFIGURATION, {
    optional: true,
  });
  const resolvedAgentId = computed(
    () => read(agentId) ?? chatConfiguration?.agentId() ?? DEFAULT_AGENT_ID,
  );
  // ponytail: outside a chat, the agent's threadId is read when the other
  // inputs change; a threadId change on the agent alone is not tracked.
  const resolvedThreadId = computed(
    () =>
      read(threadId) ??
      chatConfiguration?.threadId() ??
      core.getAgent(resolvedAgentId())?.threadId ??
      "",
  );

  // Bumped on every subagent change in the core; the computed below re-reads
  // and keeps the same array (and so notifies nobody) when its thread did not change.
  const version = signal(0);
  const subscription = core.subscribe({
    onSubagentsChanged: () => version.update((value) => value + 1),
  });
  inject(DestroyRef).onDestroy(() => subscription.unsubscribe());

  return computed(() => {
    version();
    return core.getSubagents(resolvedAgentId(), resolvedThreadId());
  });
}
