import type { Signal } from "@angular/core";
import {
  DestroyRef,
  Injectable,
  inject,
  signal,
  computed,
} from "@angular/core";
import { CopilotKit } from "./copilotkit";
import type { AbstractAgent } from "@ag-ui/client";
import type { Message } from "@ag-ui/client";
import { DEFAULT_AGENT_ID } from "@copilotkit/shared";
import type { CopilotKitCore } from "@copilotkit/core";
import {
  ProxiedCopilotRuntimeAgent,
  CopilotKitCoreRuntimeConnectionStatus,
} from "@copilotkit/core";

/** Function signature for subscribing to an agent — derived from
 *  CopilotKitCore so the types stay in sync automatically. Injected
 *  by the factory so that AgentStore stays decoupled from the concrete class. */
type SubscribeToAgentFn = CopilotKitCore["subscribeToAgentWithOptions"];
type AgentWithHeaders = AbstractAgent & { headers?: Record<string, string> };
type AgentWithCredentials = AbstractAgent & {
  credentials?: RequestCredentials;
};

const PROVISIONAL_CACHE_KEY_SEPARATOR = "\u0000";

function provisionalCacheKey(
  agentId: string,
  runtimeUrl: string,
  transport: string,
): string {
  return [agentId, runtimeUrl, transport].join(PROVISIONAL_CACHE_KEY_SEPARATOR);
}

function deleteProvisionalAgentsForId(
  cache: Map<string, ProxiedCopilotRuntimeAgent>,
  agentId: string,
): void {
  const prefix = `${agentId}${PROVISIONAL_CACHE_KEY_SEPARATOR}`;
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) {
      cache.delete(key);
    }
  }
}

function hasAgentHeaders(agent: AbstractAgent): agent is AgentWithHeaders {
  return "headers" in agent;
}

function hasAgentCredentials(
  agent: AbstractAgent,
): agent is AgentWithCredentials {
  return "credentials" in agent;
}

export class AgentStore {
  readonly #subscription?: {
    unsubscribe: () => void;
  };
  readonly #isRunning = signal<boolean>(false);
  readonly #messages = signal<Message[]>([]);
  readonly #state = signal<unknown>(undefined);

  readonly agent: AbstractAgent;
  readonly isRunning = this.#isRunning.asReadonly();
  readonly messages = this.#messages.asReadonly();
  readonly state = this.#state.asReadonly();

  constructor(
    abstractAgent: AbstractAgent,
    destroyRef: DestroyRef,
    subscribeToAgent: SubscribeToAgentFn,
  ) {
    this.agent = abstractAgent;

    this.#subscription = subscribeToAgent(abstractAgent, {
      onMessagesChanged: () => {
        this.#messages.set([...abstractAgent.messages]);
      },
      onStateChanged: () => {
        this.#state.set(abstractAgent.state);
      },
      onRunInitialized: () => {
        this.#isRunning.set(true);
      },
      onRunFinalized: () => {
        this.#isRunning.set(false);
      },
      onRunFailed: () => {
        this.#isRunning.set(false);
      },
      // Protocol-level RUN_ERROR event (distinct from onRunFailed which
      // handles local exceptions like network errors).
      onRunErrorEvent: () => {
        this.#isRunning.set(false);
      },
    });

    destroyRef.onDestroy(() => {
      this.teardown();
    });
  }

  teardown(): void {
    if (this.#subscription) {
      this.#subscription.unsubscribe();
    }
  }
}

@Injectable({ providedIn: "root" })
export class CopilotkitAgentFactory {
  readonly #copilotkit = inject(CopilotKit);

  createAgentStoreSignal(
    agentId: Signal<string | undefined>,
    destroyRef: DestroyRef,
  ): Signal<AgentStore> {
    let lastAgentStore: AgentStore | undefined;
    let lastAgent: AbstractAgent | undefined;
    const provisionalCache = new Map<string, ProxiedCopilotRuntimeAgent>();
    const subscribeToAgent: SubscribeToAgentFn =
      this.#copilotkit.core.subscribeToAgentWithOptions.bind(
        this.#copilotkit.core,
      );

    const resolveAgent = (): AbstractAgent => {
      const resolvedAgentId = agentId() || DEFAULT_AGENT_ID;
      const existing = this.#copilotkit.getAgent(resolvedAgentId);
      if (existing) {
        deleteProvisionalAgentsForId(provisionalCache, resolvedAgentId);
        return existing;
      }

      const runtimeUrl = this.#copilotkit.runtimeUrl();
      const isRuntimeConfigured = runtimeUrl !== undefined;
      const { runtimeConnectionStatus } = this.#copilotkit.core;

      if (
        isRuntimeConfigured &&
        (runtimeConnectionStatus ===
          CopilotKitCoreRuntimeConnectionStatus.Disconnected ||
          runtimeConnectionStatus ===
            CopilotKitCoreRuntimeConnectionStatus.Connecting ||
          runtimeConnectionStatus ===
            CopilotKitCoreRuntimeConnectionStatus.Error)
      ) {
        const headers = this.#copilotkit.headers();
        const credentials = this.#copilotkit.credentials();
        const transport = this.#copilotkit.runtimeTransport();
        const cacheKey = provisionalCacheKey(
          resolvedAgentId,
          runtimeUrl,
          transport,
        );
        const cached = provisionalCache.get(cacheKey);
        if (cached) {
          if (hasAgentHeaders(cached)) {
            cached.headers = { ...headers };
          }
          if (hasAgentCredentials(cached)) {
            cached.credentials = credentials;
          }
          return cached;
        }

        const provisional = new ProxiedCopilotRuntimeAgent({
          runtimeUrl,
          agentId: resolvedAgentId,
          transport,
          credentials,
          runtimeMode: "pending",
        });
        if (hasAgentHeaders(provisional)) {
          provisional.headers = { ...headers };
        }
        provisionalCache.set(cacheKey, provisional);
        return provisional;
      }

      const knownAgents = Object.keys(this.#copilotkit.agents() ?? {});
      const runtimePart = isRuntimeConfigured
        ? `runtimeUrl=${runtimeUrl}`
        : "no runtimeUrl";
      throw new Error(
        `injectAgentStore: Agent '${resolvedAgentId}' not found after runtime sync (${runtimePart}). ` +
          (knownAgents.length
            ? `Known agents: [${knownAgents.join(", ")}]`
            : "No agents registered.") +
          " Verify your runtime /info and/or agents__unsafe_dev_only.",
      );
    };

    return computed(() => {
      this.#copilotkit.agents();
      this.#copilotkit.runtimeConnectionStatus();
      this.#copilotkit.runtimeUrl();
      this.#copilotkit.runtimeTransport();
      this.#copilotkit.headers();

      const agent = resolveAgent();

      if (lastAgentStore && lastAgent === agent) {
        return lastAgentStore;
      }

      lastAgentStore?.teardown();
      lastAgent = agent;
      lastAgentStore = new AgentStore(agent, destroyRef, subscribeToAgent);
      return lastAgentStore;
    });
  }
}

export function injectAgentStore(
  agentId: string | Signal<string | undefined>,
): Signal<AgentStore> {
  const agentFactory = inject(CopilotkitAgentFactory);
  const destroyRef = inject(DestroyRef);
  const agentIdSignal =
    typeof agentId === "function" ? agentId : computed(() => agentId);

  return agentFactory.createAgentStoreSignal(agentIdSignal, destroyRef);
}
