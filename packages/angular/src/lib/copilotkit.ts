import { AbstractAgent } from "@ag-ui/client";
import {
  FrontendTool,
  CopilotKitCore,
  CopilotKitCoreRuntimeConnectionStatus,
  CopilotRuntimeTransport,
} from "@copilotkit/core";
import {
  Injectable,
  Injector,
  Signal,
  WritableSignal,
  runInInjectionContext,
  signal,
  inject,
} from "@angular/core";
import {
  FrontendToolConfig,
  HumanInTheLoopConfig,
  RenderToolCallConfig,
} from "./tools";
import { injectCopilotKitConfig } from "./config";
import { HumanInTheLoop } from "./human-in-the-loop";
import { ensureLicenseWatermark } from "./license-watermark";
import type {
  ActivityMessageRendererConfig,
  CustomMessageRendererConfig,
} from "./render-messages";

@Injectable({ providedIn: "root" })
export class CopilotKit {
  readonly #config = injectCopilotKitConfig();
  readonly #hitl = inject(HumanInTheLoop);
  readonly #rootInjector = inject(Injector);
  readonly #agents = signal<Record<string, AbstractAgent>>(
    this.#config.agents ?? {},
  );
  readonly agents = this.#agents.asReadonly();
  readonly #runtimeConnectionStatus =
    signal<CopilotKitCoreRuntimeConnectionStatus>(
      CopilotKitCoreRuntimeConnectionStatus.Disconnected,
    );
  readonly runtimeConnectionStatus = this.#runtimeConnectionStatus.asReadonly();
  readonly #runtimeUrl = signal<string | undefined>(undefined);
  readonly runtimeUrl = this.#runtimeUrl.asReadonly();
  readonly #runtimeTransport = signal<CopilotRuntimeTransport>("auto");
  readonly runtimeTransport = this.#runtimeTransport.asReadonly();
  readonly #headers = signal<Record<string, string>>({});
  readonly headers = this.#headers.asReadonly();

  readonly core = new CopilotKitCore({
    runtimeUrl: this.#config.runtimeUrl,
    headers: this.#config.headers,
    properties: this.#config.properties,
    agents__unsafe_dev_only: {
      ...this.#config.agents,
      ...this.#config.selfManagedAgents,
    },
    tools: this.#config.tools,
  });

  readonly #toolCallRenderConfigs: WritableSignal<RenderToolCallConfig[]> =
    signal([]);
  readonly #clientToolCallRenderConfigs: WritableSignal<FrontendToolConfig[]> =
    signal([]);
  readonly #humanInTheLoopToolRenderConfigs: WritableSignal<
    HumanInTheLoopConfig[]
  > = signal([]);

  readonly toolCallRenderConfigs: Signal<RenderToolCallConfig[]> =
    this.#toolCallRenderConfigs.asReadonly();
  readonly clientToolCallRenderConfigs: Signal<FrontendToolConfig[]> =
    this.#clientToolCallRenderConfigs.asReadonly();
  readonly humanInTheLoopToolRenderConfigs: Signal<HumanInTheLoopConfig[]> =
    this.#humanInTheLoopToolRenderConfigs.asReadonly();

  readonly #renderActivityMessageConfigs: WritableSignal<
    ActivityMessageRendererConfig[]
  > = signal([]);
  readonly #renderCustomMessageConfigs: WritableSignal<
    CustomMessageRendererConfig[]
  > = signal([]);

  /**
   * Activity message renderers registered with the registry. Mirrors React's
   * `copilotkit.renderActivityMessages`.
   */
  readonly renderActivityMessageConfigs: Signal<
    ActivityMessageRendererConfig[]
  > = this.#renderActivityMessageConfigs.asReadonly();

  /**
   * Custom message renderers registered with the registry. Mirrors React's
   * `copilotkit.renderCustomMessages`.
   */
  readonly renderCustomMessageConfigs: Signal<CustomMessageRendererConfig[]> =
    this.#renderCustomMessageConfigs.asReadonly();

  /**
   * Per-(registry-agent, threadId) clones used by the chat view. Activity and
   * custom-message renderers prefer the clone over the registry agent so
   * `runAgent`/`messages` reads stay consistent with the visible chat.
   */
  readonly #threadClones = new WeakMap<
    AbstractAgent,
    Map<string, AbstractAgent>
  >();

  constructor() {
    ensureLicenseWatermark(this.#config.headers);

    this.#runtimeConnectionStatus.set(this.core.runtimeConnectionStatus);
    this.#runtimeUrl.set(this.core.runtimeUrl);
    this.#runtimeTransport.set(this.core.runtimeTransport);
    this.#headers.set(this.core.headers);
    this.#config.renderToolCalls?.forEach((renderConfig) => {
      this.addRenderToolCall(renderConfig);
    });

    this.#config.tools?.forEach((tool) => {
      if (tool.renderer && tool.parameters) {
        this.addRenderToolCall({
          name: tool.name,
          args: tool.parameters,
          component: tool.renderer,
          agentId: tool.agentId,
        });
      }
    });

    this.#config.frontendTools?.forEach((clientTool) => {
      this.addFrontendTool({ ...clientTool, injector: this.#rootInjector });
    });

    this.#config.humanInTheLoop?.forEach((humanInTheLoopTool) => {
      this.addHumanInTheLoop(humanInTheLoopTool);
    });

    this.core.subscribe({
      onAgentsChanged: () => {
        this.#agents.set(this.core.agents);
      },
      onRuntimeConnectionStatusChanged: ({ status }) => {
        this.#runtimeConnectionStatus.set(status);
      },
      onHeadersChanged: ({ headers }) => {
        this.#headers.set(headers);
      },
    });
  }

  #bindClientTool(
    clientToolWithInjector: FrontendToolConfig & {
      injector: Injector;
    },
  ): FrontendTool {
    const { injector, handler, ...frontendCandidate } = clientToolWithInjector;

    return {
      ...frontendCandidate,
      handler: (args, context) =>
        runInInjectionContext(injector, () => handler(args, context)),
    };
  }

  addFrontendTool(
    clientToolWithInjector: FrontendToolConfig & {
      injector: Injector;
    },
  ): void {
    const tool = this.#bindClientTool(clientToolWithInjector);

    this.core.addTool(tool);

    this.#clientToolCallRenderConfigs.update((current) => [
      ...current,
      clientToolWithInjector,
    ]);
  }

  addRenderToolCall(renderConfig: RenderToolCallConfig): void {
    this.#toolCallRenderConfigs.update((current) => [...current, renderConfig]);
  }

  #bindHumanInTheLoopTool(
    humanInTheLoopTool: HumanInTheLoopConfig,
  ): FrontendTool {
    return {
      ...humanInTheLoopTool,
      handler: (args, { toolCall }) => {
        return this.#hitl.onResult(toolCall.id, humanInTheLoopTool.name);
      },
    };
  }

  addHumanInTheLoop(humanInTheLoopTool: HumanInTheLoopConfig): void {
    this.#humanInTheLoopToolRenderConfigs.update((current) => [
      ...current,
      humanInTheLoopTool,
    ]);

    const tool = this.#bindHumanInTheLoopTool(humanInTheLoopTool);

    this.core.addTool(tool);
  }

  #isSameAgentId<T extends { agentId?: string }>(
    target: T,
    agentId?: string,
  ): boolean {
    if (agentId) {
      return target.agentId === agentId;
    }

    return true;
  }

  removeTool(toolName: string, agentId?: string): void {
    this.core.removeTool(toolName, agentId);
    const keep = (config: { name: string; agentId?: string }) =>
      config.name !== toolName ||
      (agentId === undefined
        ? !!config.agentId
        : !this.#isSameAgentId(config, agentId));
    this.#clientToolCallRenderConfigs.update((current) => current.filter(keep));
    this.#humanInTheLoopToolRenderConfigs.update((current) =>
      current.filter(keep),
    );
    this.#toolCallRenderConfigs.update((current) => current.filter(keep));
  }

  getAgent(agentId: string): AbstractAgent | undefined {
    return this.core.getAgent(agentId);
  }

  /**
   * Look up an existing per-thread agent clone, when one has been associated
   * with this registry agent + thread. Returns `undefined` when no clone has
   * been registered. Mirrors `getThreadClone` from React's `use-agent`.
   */
  getThreadClone(
    registryAgent: AbstractAgent | undefined | null,
    threadId: string | undefined | null,
  ): AbstractAgent | undefined {
    if (!registryAgent || !threadId) return undefined;
    return this.#threadClones.get(registryAgent)?.get(threadId);
  }

  /**
   * Associate a per-thread clone with the given registry agent + thread.
   * Used by chat views that maintain their own per-thread agent so renderer
   * resolution can hand the matching clone to user components.
   */
  setThreadClone(
    registryAgent: AbstractAgent,
    threadId: string,
    clone: AbstractAgent,
  ): void {
    let byThread = this.#threadClones.get(registryAgent);
    if (!byThread) {
      byThread = new Map();
      this.#threadClones.set(registryAgent, byThread);
    }
    byThread.set(threadId, clone);
  }

  /** Remove a previously-associated thread clone, if any. */
  clearThreadClone(registryAgent: AbstractAgent, threadId: string): void {
    this.#threadClones.get(registryAgent)?.delete(threadId);
  }

  addRenderActivityMessage(
    config: ActivityMessageRendererConfig<unknown>,
  ): void {
    this.#renderActivityMessageConfigs.update((current) => [
      ...current,
      config,
    ]);
  }

  removeRenderActivityMessage(
    config: ActivityMessageRendererConfig<unknown>,
  ): void {
    this.#renderActivityMessageConfigs.update((current) =>
      current.filter((c) => c !== config),
    );
  }

  addRenderCustomMessage(config: CustomMessageRendererConfig): void {
    this.#renderCustomMessageConfigs.update((current) => [...current, config]);
  }

  removeRenderCustomMessage(config: CustomMessageRendererConfig): void {
    this.#renderCustomMessageConfigs.update((current) =>
      current.filter((c) => c !== config),
    );
  }

  updateRuntime(options: {
    runtimeUrl?: string;
    runtimeTransport?: CopilotRuntimeTransport;
    headers?: Record<string, string>;
    properties?: Record<string, unknown>;
    agents?: Record<string, AbstractAgent>;
    selfManagedAgents?: Record<string, AbstractAgent>;
  }): void {
    if (options.runtimeUrl !== undefined) {
      this.core.setRuntimeUrl(options.runtimeUrl);
      this.#runtimeUrl.set(options.runtimeUrl);
    }
    if (options.runtimeTransport !== undefined) {
      this.core.setRuntimeTransport(options.runtimeTransport);
      this.#runtimeTransport.set(options.runtimeTransport);
    }
    if (options.headers !== undefined) {
      this.core.setHeaders(options.headers);
      this.#headers.set(options.headers);
    }
    if (options.properties !== undefined) {
      this.core.setProperties(options.properties);
    }
    if (
      options.agents !== undefined ||
      options.selfManagedAgents !== undefined
    ) {
      this.core.setAgents__unsafe_dev_only({
        ...(options.agents ?? this.#config.agents),
        ...(options.selfManagedAgents ?? this.#config.selfManagedAgents),
      });
    }
  }
}
