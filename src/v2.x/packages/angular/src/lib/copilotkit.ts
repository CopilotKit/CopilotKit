import { AbstractAgent } from "@ag-ui/client";
import { FrontendTool, CopilotKitCore } from "@copilotkitnext/core";
import { Injectable, Injector, Signal, WritableSignal, runInInjectionContext, signal, inject } from "@angular/core";
import { FrontendToolConfig, HumanInTheLoopConfig, RenderToolCallConfig } from "./tools";
import { injectCopilotKitConfig } from "./config";
import { HumanInTheLoop } from "./human-in-the-loop";

@Injectable({ providedIn: "root" })
export class CopilotKit {
  readonly #config = injectCopilotKitConfig();
  readonly #hitl = inject(HumanInTheLoop);
  readonly #rootInjector = inject(Injector);
  readonly #agents = signal<Record<string, AbstractAgent>>(this.#config.agents ?? {});
  readonly agents = this.#agents.asReadonly();

  readonly core = new CopilotKitCore({
    runtimeUrl: this.#config.runtimeUrl,
    headers: this.#config.headers,
    properties: this.#config.properties,
    agents__unsafe_dev_only: this.#config.agents,
    tools: this.#config.tools,
  });

  readonly #toolCallRenderConfigs: WritableSignal<RenderToolCallConfig[]> = signal([]);
  readonly #clientToolCallRenderConfigs: WritableSignal<FrontendToolConfig[]> = signal([]);
  readonly #humanInTheLoopToolRenderConfigs: WritableSignal<HumanInTheLoopConfig[]> = signal([]);

  readonly toolCallRenderConfigs: Signal<RenderToolCallConfig[]> = this.#toolCallRenderConfigs.asReadonly();
  readonly clientToolCallRenderConfigs: Signal<FrontendToolConfig[]> = this.#clientToolCallRenderConfigs.asReadonly();
  readonly humanInTheLoopToolRenderConfigs: Signal<HumanInTheLoopConfig[]> =
    this.#humanInTheLoopToolRenderConfigs.asReadonly();

  constructor() {
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
      handler: (args) => runInInjectionContext(injector, () => handler(args)),
    };
  }

  addFrontendTool(
    clientToolWithInjector: FrontendToolConfig & {
      injector: Injector;
    },
  ): void {
    const tool = this.#bindClientTool(clientToolWithInjector);

    this.core.addTool(tool);

    this.#clientToolCallRenderConfigs.update((current) => [...current, clientToolWithInjector]);
  }

  addRenderToolCall(renderConfig: RenderToolCallConfig): void {
    this.#toolCallRenderConfigs.update((current) => [...current, renderConfig]);
  }

  #bindHumanInTheLoopTool(humanInTheLoopTool: HumanInTheLoopConfig): FrontendTool {
    return {
      ...humanInTheLoopTool,
      handler: (args, toolCall) => {
        return this.#hitl.onResult(toolCall.id, humanInTheLoopTool.name);
      },
    };
  }

  addHumanInTheLoop(humanInTheLoopTool: HumanInTheLoopConfig): void {
    this.#humanInTheLoopToolRenderConfigs.update((current) => [...current, humanInTheLoopTool]);

    const tool = this.#bindHumanInTheLoopTool(humanInTheLoopTool);

    this.core.addTool(tool);
  }

  #isSameAgentId<T extends { agentId?: string }>(target: T, agentId?: string): boolean {
    if (agentId) {
      return target.agentId === agentId;
    }

    return true;
  }

  removeTool(toolName: string, agentId?: string): void {
    this.core.removeTool(toolName);
    this.#clientToolCallRenderConfigs.update((current) =>
      current.filter((renderConfig) => renderConfig.name !== toolName && this.#isSameAgentId(renderConfig, agentId)),
    );
    this.#humanInTheLoopToolRenderConfigs.update((current) =>
      current.filter((renderConfig) => renderConfig.name !== toolName && this.#isSameAgentId(renderConfig, agentId)),
    );
    this.#toolCallRenderConfigs.update((current) =>
      current.filter((renderConfig) => renderConfig.name !== toolName && this.#isSameAgentId(renderConfig, agentId)),
    );
  }

  getAgent(agentId: string): AbstractAgent | undefined {
    return this.core.getAgent(agentId);
  }

  updateRuntime(options: {
    runtimeUrl?: string;
    headers?: Record<string, string>;
    properties?: Record<string, unknown>;
    agents?: Record<string, AbstractAgent>;
  }): void {
    if (options.runtimeUrl !== undefined) {
      this.core.setRuntimeUrl(options.runtimeUrl);
    }
    if (options.headers !== undefined) {
      this.core.setHeaders(options.headers);
    }
    if (options.properties !== undefined) {
      this.core.setProperties(options.properties);
    }
    if (options.agents !== undefined) {
      this.core.setAgents__unsafe_dev_only(options.agents);
    }
  }
}
