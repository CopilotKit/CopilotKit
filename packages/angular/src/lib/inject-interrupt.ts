import {
  DestroyRef,
  computed,
  effect,
  inject,
  type Signal,
} from "@angular/core";
import { DEFAULT_AGENT_ID } from "@copilotkit/shared";

import { injectAgentStore } from "./agent";
import { COPILOT_CHAT_CONFIGURATION } from "./chat-configuration";
import { CopilotKit } from "./copilotkit";
import { InterruptController } from "./interrupt";
import type { InjectInterruptOptions } from "./interrupt";

type InterruptAgentId = string | Signal<string | undefined>;

/**
 * Create an interrupt controller in the current Angular injection context.
 *
 * The controller follows the ambient chat agent and thread unless an explicit
 * agent id or signal is supplied as the first argument. Bind its signals in a
 * template and call `resolve` or `cancel` from user-driven event handlers.
 */
export function injectInterrupt<TValue = unknown, TResult = never>(
  agentId?: InterruptAgentId,
  options?: Omit<InjectInterruptOptions<TValue, TResult>, "agentId">,
): InterruptController<TValue, TResult>;
/** Compatibility overload for the original options-only call shape. */
export function injectInterrupt<TValue = unknown, TResult = never>(
  options?: InjectInterruptOptions<TValue, TResult>,
): InterruptController<TValue, TResult>;
export function injectInterrupt<TValue = unknown, TResult = never>(
  agentIdOrOptions?: InterruptAgentId | InjectInterruptOptions<TValue, TResult>,
  controllerOptions?: Omit<InjectInterruptOptions<TValue, TResult>, "agentId">,
): InterruptController<TValue, TResult> {
  const copilotKit = inject(CopilotKit);
  const destroyRef = inject(DestroyRef);
  const chatConfiguration = inject(COPILOT_CHAT_CONFIGURATION, {
    optional: true,
  });
  const hasAgentIdArgument =
    controllerOptions !== undefined ||
    typeof agentIdOrOptions === "string" ||
    typeof agentIdOrOptions === "function";
  const options: InjectInterruptOptions<TValue, TResult> = hasAgentIdArgument
    ? (controllerOptions ?? {})
    : ((agentIdOrOptions as
        | InjectInterruptOptions<TValue, TResult>
        | undefined) ?? {});
  const configuredAgentId = hasAgentIdArgument
    ? (agentIdOrOptions as InterruptAgentId | undefined)
    : options.agentId;
  const agentId =
    configuredAgentId ??
    computed(() => chatConfiguration?.agentId() ?? DEFAULT_AGENT_ID);
  const store = injectAgentStore(agentId);
  const controller = new InterruptController<TValue, TResult>(
    (agent, runOptions) => copilotKit.core.runAgent({ agent, ...runOptions }),
    options,
  );
  const connection = effect(() => {
    const agent = store().agent;
    controller.connect(agent);
    controller.setThreadId(
      configuredAgentId === undefined
        ? (chatConfiguration?.threadId() ?? agent.threadId)
        : agent.threadId,
    );
  });

  destroyRef.onDestroy(() => {
    connection.destroy();
    controller.destroy();
  });
  return controller;
}
