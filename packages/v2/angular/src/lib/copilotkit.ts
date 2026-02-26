import { AbstractAgent } from "@ag-ui/client";
import {
  FrontendTool,
  CopilotKitCore,
  CopilotKitCoreRuntimeConnectionStatus,
  CopilotRuntimeTransport,
} from "@copilotkitnext/core";
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
  readonly #runtimeTransport = signal<CopilotRuntimeTransport>("rest");
  readonly runtimeTransport = this.#runtimeTransport.asReadonly();
  readonly #headers = signal<Record<string, string>>({});
  readonly headers = this.#headers.asReadonly();

  readonly core = new CopilotKitCore({
    runtimeUrl: this.#config.runtimeUrl,
    headers: this.#config.headers,
    properties: this.#config.properties,
    agents__unsafe_dev_only: this.#config.agents,
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

  constructor() {
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

  updateRuntime(options: {
    runtimeUrl?: string;
    runtimeTransport?: CopilotRuntimeTransport;
    headers?: Record<string, string>;
    properties?: Record<string, unknown>;
    agents?: Record<string, AbstractAgent>;
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
    if (options.agents !== undefined) {
      this.core.setAgents__unsafe_dev_only(options.agents);
    }
  }
}
