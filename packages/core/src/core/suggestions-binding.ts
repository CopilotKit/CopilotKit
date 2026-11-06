import type { AbstractAgent } from "@ag-ui/client";
import { DEFAULT_AGENT_ID } from "@copilotkit/shared";
import type {
  CopilotKitCore,
  CopilotKitCoreGetSuggestionsResult,
} from "./core";
import type {
  DynamicSuggestionsConfig,
  StaticSuggestionsConfig,
  Suggestion,
  SuggestionsConfig,
} from "../types";

/**
 * A static suggestion as callers write it: `isLoading` may be left out.
 *
 * @internal Framework adapters use this type. Applications must not depend on it.
 */
export type ɵStaticSuggestionInput = Omit<Suggestion, "isLoading"> &
  Partial<Pick<Suggestion, "isLoading">>;

/**
 * The suggestions config a framework hook accepts.
 *
 * @internal Framework adapters use this type. Applications must not depend on it.
 */
export type ɵSuggestionsConfigInput =
  | DynamicSuggestionsConfig
  | (Omit<StaticSuggestionsConfig, "suggestions"> & {
      suggestions: ɵStaticSuggestionInput[];
    });

/** @internal Options for {@link ɵbindSuggestionsConfig}. */
export interface ɵSuggestionsBindingOptions {
  /**
   * The agent of the chat the config is declared in: the chat configuration's
   * agent, else the provider default. Falls back to `"default"`.
   */
  chatAgentId?: string;
}

/** @internal The handle {@link ɵbindSuggestionsConfig} returns. */
export interface ɵSuggestionsBinding {
  /**
   * Applies the latest config. A config with the same content (by JSON) and
   * the same chat agent is a no-op, so callers may pass a new object on every
   * render.
   */
  update(
    config: ɵSuggestionsConfigInput | null | undefined,
    options?: ɵSuggestionsBindingOptions,
  ): void;
  /** Reloads suggestions for the config's agents, for example when a hook's extra dependencies change. */
  reload(): void;
  /** Removes the config and stops every pending retry. */
  dispose(): void;
}

function isGlobalConsumer(consumerAgentId: string | undefined) {
  return consumerAgentId === undefined || consumerAgentId === "*";
}

/**
 * The key a config is deduplicated by. Static suggestions without `isLoading`
 * and with `isLoading: false` are the same config.
 */
function suggestionsConfigKey(config: SuggestionsConfig) {
  if ("instructions" in config) return JSON.stringify(config);
  return JSON.stringify({
    ...config,
    suggestions: config.suggestions.map((suggestion) => ({
      isLoading: false,
      ...suggestion,
    })),
  });
}

/**
 * How often a skipped agent is checked while it runs. ag-ui agents take
 * subscribers only when a run starts, so a run already in progress (a run or a
 * reconnect) can only be observed by checking `isRunning`.
 */
const RETRY_CHECK_INTERVAL_MS = 100;

class SuggestionsBinding implements ɵSuggestionsBinding {
  readonly #core: CopilotKitCore;
  #config: SuggestionsConfig | null = null;
  #key: string | null = null;
  #chatAgentId: string = DEFAULT_AGENT_ID;
  #registrationId: string | null = null;
  #disposed = false;
  /** Agents a global reload skipped because they were running. */
  readonly #pendingRetries = new Map<string, AbstractAgent>();
  #retryTimer: ReturnType<typeof setTimeout> | null = null;
  #stopWaitingForAgent: (() => void) | null = null;
  readonly #unsubscribeCore: () => void;

  constructor(core: CopilotKitCore) {
    this.#core = core;
    // Core reloads an agent's suggestions right after a run it drove. When
    // that happens first, a retry for the agent would only generate twice.
    const subscription = core.subscribe({
      onSuggestionsChanged: ({ agentId }) => {
        const agent = this.#pendingRetries.get(agentId);
        if (agent && !agent.isRunning) this.#cancelRetry(agentId);
      },
    });
    this.#unsubscribeCore = () => subscription.unsubscribe();
  }

  update(
    input: ɵSuggestionsConfigInput | null | undefined,
    options: ɵSuggestionsBindingOptions = {},
  ) {
    if (this.#disposed) return;
    const config = input && input.available !== "disabled" ? input : null;
    const key = config ? suggestionsConfigKey(config) : null;
    const chatAgentId = options.chatAgentId ?? DEFAULT_AGENT_ID;
    const configChanged = key !== this.#key;
    const chatAgentChanged = chatAgentId !== this.#chatAgentId;
    if (!configChanged && !chatAgentChanged) return;

    this.#chatAgentId = chatAgentId;
    if (configChanged) {
      this.#key = key;
      this.#config = config;
      this.#unregister();
      this.#cancelAllRetries();
      if (config)
        this.#registrationId = this.#core.addSuggestionsConfig(config);
    }
    this.#waitForTargetAgent();
    this.reload();
  }

  reload() {
    const config = this.#config;
    if (this.#disposed || !config) return;
    if (!isGlobalConsumer(config.consumerAgentId)) {
      this.#core.reloadSuggestions(this.#targetAgentId(config));
      return;
    }

    const agents = Object.values(this.#core.agents);
    const seen = new Set<string>();
    for (const agent of agents) {
      const agentId = agent.agentId;
      if (!agentId) continue;
      seen.add(agentId);
      if (agent.isRunning) {
        this.#retryWhenRunEnds(agent, agentId);
        continue;
      }
      this.#cancelRetry(agentId);
      this.#core.reloadSuggestions(agentId);
    }
    // The registry can still be empty (runtime info loading). Reload the
    // chat's own agent anyway, so static suggestions show on the welcome
    // screen right away.
    if (!seen.has(this.#chatAgentId)) {
      this.#core.reloadSuggestions(this.#chatAgentId);
    }
  }

  dispose() {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#unregister();
    this.#cancelAllRetries();
    this.#stopWaitingForAgent?.();
    this.#stopWaitingForAgent = null;
    this.#unsubscribeCore();
    this.#config = null;
    this.#key = null;
  }

  #targetAgentId(config: SuggestionsConfig) {
    return isGlobalConsumer(config.consumerAgentId)
      ? this.#chatAgentId
      : (config.consumerAgentId ?? this.#chatAgentId);
  }

  #unregister() {
    if (this.#registrationId === null) return;
    this.#core.removeSuggestionsConfig(this.#registrationId);
    this.#registrationId = null;
  }

  /**
   * Dynamic suggestions need their agent in the registry. When it is not
   * there yet, reload once it arrives. Stops after the first arrival, so later
   * registry changes do not stack generations.
   */
  #waitForTargetAgent() {
    this.#stopWaitingForAgent?.();
    this.#stopWaitingForAgent = null;
    const config = this.#config;
    if (!config || !("instructions" in config)) return;
    const targetAgentId = this.#targetAgentId(config);
    if (this.#core.getAgent(targetAgentId)) return;

    const subscription = this.#core.subscribe({
      onAgentsChanged: () => {
        if (!this.#core.getAgent(targetAgentId)) return;
        stop();
        this.reload();
      },
    });
    const stop = () => {
      subscription.unsubscribe();
      if (this.#stopWaitingForAgent === stop) this.#stopWaitingForAgent = null;
    };
    this.#stopWaitingForAgent = stop;
  }

  /** Reloads a skipped agent once its run (or reconnect) ends. */
  #retryWhenRunEnds(agent: AbstractAgent, agentId: string) {
    this.#pendingRetries.set(agentId, agent);
    this.#scheduleRetryCheck();
  }

  #scheduleRetryCheck() {
    if (this.#retryTimer !== null || this.#pendingRetries.size === 0) return;
    this.#retryTimer = setTimeout(() => {
      this.#retryTimer = null;
      const pending = [...this.#pendingRetries];
      for (const [agentId, agent] of pending) {
        if (agent.isRunning) continue;
        this.#pendingRetries.delete(agentId);
        this.#core.reloadSuggestions(agentId);
      }
      this.#scheduleRetryCheck();
    }, RETRY_CHECK_INTERVAL_MS);
  }

  #cancelRetry(agentId: string) {
    this.#pendingRetries.delete(agentId);
    if (this.#pendingRetries.size > 0 || this.#retryTimer === null) return;
    clearTimeout(this.#retryTimer);
    this.#retryTimer = null;
  }

  #cancelAllRetries() {
    this.#pendingRetries.clear();
    if (this.#retryTimer !== null) clearTimeout(this.#retryTimer);
    this.#retryTimer = null;
  }
}

/**
 * Registers a suggestions config with `core` and keeps it current: the
 * framework `useConfigureSuggestions` hooks (and Angular's
 * `configureSuggestions`) are thin wrappers around this binding.
 *
 * The binding owns: dropping `available: "disabled"` configs, deduplicating
 * equal configs, resolving the target agent (`consumerAgentId`, or the chat's
 * agent for a global `"*"` config), reloading every idle agent for a global
 * config, retrying agents that were running once their run ends, and waiting
 * for a dynamic config's agent to register.
 *
 * @example
 * const binding = ɵbindSuggestionsConfig(core, config, { chatAgentId });
 * binding.update(nextConfig, { chatAgentId });
 * binding.dispose();
 *
 * @internal Framework adapters use this function. Applications must not depend on it.
 */
export function ɵbindSuggestionsConfig(
  core: CopilotKitCore,
  config: ɵSuggestionsConfigInput | null | undefined,
  options: ɵSuggestionsBindingOptions = {},
) {
  const binding: ɵSuggestionsBinding = new SuggestionsBinding(core);
  binding.update(config, options);
  return binding;
}

/**
 * Calls `listener` with the agent's suggestions and loading state whenever
 * either changes. The result object stays the same until something changes,
 * so it can back `useSyncExternalStore`, a `shallowRef` or a `signal`.
 * Does not call `listener` for the current value; read
 * `core.getSuggestions(agentId)` for that.
 *
 * @example
 * const unsubscribe = ɵsubscribeToAgentSuggestions(core, "default", (result) => {
 *   render(result.suggestions, result.isLoading);
 * });
 *
 * @internal Framework adapters use this function. Applications must not depend on it.
 */
export function ɵsubscribeToAgentSuggestions(
  core: CopilotKitCore,
  agentId: string,
  listener: (result: CopilotKitCoreGetSuggestionsResult) => void,
) {
  let current = core.getSuggestions(agentId);
  const publish = (next: CopilotKitCoreGetSuggestionsResult) => {
    const isUnchanged =
      next.suggestions === current.suggestions &&
      next.isLoading === current.isLoading;
    if (isUnchanged) return;
    current = next;
    listener(next);
  };
  // Loading events fire before core's running set changes, so the loading
  // flag comes from the event and the list from core.
  const subscription = core.subscribe({
    onSuggestionsChanged: (event) => {
      if (event.agentId !== agentId) return;
      publish({
        suggestions: event.suggestions,
        isLoading: core.getSuggestions(agentId).isLoading,
      });
    },
    onSuggestionsStartedLoading: (event) => {
      if (event.agentId !== agentId) return;
      publish({ suggestions: current.suggestions, isLoading: true });
    },
    onSuggestionsFinishedLoading: (event) => {
      if (event.agentId !== agentId) return;
      publish({ suggestions: current.suggestions, isLoading: false });
    },
    onSuggestionsConfigChanged: () => {
      publish(core.getSuggestions(agentId));
    },
  });
  return () => subscription.unsubscribe();
}
