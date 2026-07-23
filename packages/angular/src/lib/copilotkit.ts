import { AbstractAgent } from "@ag-ui/client";
import {
  FrontendTool,
  CopilotKitCore,
  CopilotKitCoreRuntimeConnectionStatus,
  CopilotRuntimeTransport,
  type CopilotKitCoreGetSuggestionsResult,
  type IntelligenceRuntimeInfo,
  type RuntimeLicenseStatus,
  type SuggestionsConfig,
  type ThreadEndpointRuntimeInfo,
} from "@copilotkit/core";
import {
  Injectable,
  Injector,
  Signal,
  WritableSignal,
  computed,
  runInInjectionContext,
  signal,
  inject,
} from "@angular/core";
import {
  FrontendToolConfig,
  HumanInTheLoopConfig,
  RenderToolCallConfig,
} from "./tools";
import {
  A2UI_DEFAULT_DESIGN_GUIDELINES,
  A2UI_DEFAULT_GENERATION_GUIDELINES,
  schemaToJsonSchema,
} from "@copilotkit/shared";
import {
  A2UI_SCHEMA_CONTEXT_DESCRIPTION,
  buildCatalogContextValue,
  extractCatalogComponentSchemas,
} from "@copilotkit/a2ui-renderer/web-components";
import {
  ɵCOPILOTKIT_BUILT_IN_ACTIVITY_RENDERERS,
  RenderActivityMessageConfig,
  anyActivityContentSchema,
} from "./activity-renderer";
import { injectCopilotKitConfig } from "./config";
import { HumanInTheLoop } from "./human-in-the-loop";
import { ensureLicenseWatermark } from "./license-watermark";
import { CopilotA2UIActivityRenderer } from "./components/a2ui/a2ui-activity-renderer";
import { CopilotA2UIToolRenderer } from "./components/a2ui/a2ui-tool-renderer";
import {
  AGUI_SEND_STATE_SNAPSHOT_TOOL_NAME,
  RENDER_A2UI_TOOL_NAME,
  RenderA2UIArgsSchema,
} from "./components/a2ui/a2ui-tool-types";
import {
  DEFAULT_OPEN_GENERATIVE_UI_DESIGN_SKILL,
  GENERATE_SANDBOXED_UI_DESCRIPTION,
  GENERATE_SANDBOXED_UI_TOOL_NAME,
  GenerateSandboxedUiArgsSchema,
  OPEN_GENERATIVE_UI_ACTIVITY_TYPE,
  type GenerateSandboxedUiArgs,
} from "./open-generative-ui";
import { CopilotOpenGenerativeUIActivityRenderer } from "./components/open-generative-ui/open-generative-ui-activity-renderer";
import { CopilotOpenGenerativeUIToolRenderer } from "./components/open-generative-ui/open-generative-ui-tool-renderer";
import { standardSchemaZodToJsonSchema } from "./standard-schema-zod";

/**
 * Advertise a client-provided A2UI catalog to the runtime without mutating the
 * caller's properties object. The runtime uses this per-run capability to
 * enable A2UI middleware and inject its render tool when endpoint configuration
 * does not opt in separately; this mirrors the React provider contract.
 */
function withA2UICatalogCapability(
  properties: Record<string, unknown> | undefined,
  hasCatalog: boolean,
): Record<string, unknown> | undefined {
  return hasCatalog
    ? { ...properties, a2uiCatalogAvailable: true }
    : properties;
}

@Injectable({ providedIn: "root" })
export class CopilotKit {
  readonly #config = injectCopilotKitConfig();
  readonly #extensionActivityMessageRenderers = inject(
    ɵCOPILOTKIT_BUILT_IN_ACTIVITY_RENDERERS,
  );
  readonly #hitl = inject(HumanInTheLoop);
  readonly #rootInjector = inject(Injector);
  /** Whether unknown tools may use the built-in text-only fallback renderer. */
  readonly defaultToolRenderingEnabled =
    this.#config.defaultToolRendering === true;
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
  readonly #threadEndpoints = signal<ThreadEndpointRuntimeInfo | undefined>(
    undefined,
  );
  /**
   * Thread-endpoint capability advertised by the connected runtime's `/info`
   * response, or `undefined` before the runtime reports `Connected`. Exposed
   * as a signal (rather than a plain `core.threadEndpoints` read) so reactive
   * consumers re-run when `/info` lands.
   */
  readonly threadEndpoints = this.#threadEndpoints.asReadonly();
  readonly #intelligence = signal<IntelligenceRuntimeInfo | undefined>(
    undefined,
  );
  /**
   * Intelligence runtime info advertised by the connected runtime's `/info`
   * response, or `undefined` before the runtime reports `Connected`. Carries
   * the realtime `wsUrl`. Exposed as a signal so reactive consumers re-run
   * when `/info` populates it — even if the connection status does not
   * transition in the same turn.
   */
  readonly intelligence = this.#intelligence.asReadonly();
  readonly #licenseStatus = signal<RuntimeLicenseStatus | undefined>(undefined);
  /**
   * Server-reported license status from the connected runtime's `/info`
   * response, or `undefined` before the runtime reports it. Exposed as a signal
   * (rather than a plain `core.licenseStatus` read) so reactive consumers — e.g.
   * the threads drawer's license gate — re-run once the status resolves.
   */
  readonly licenseStatus = this.#licenseStatus.asReadonly();
  readonly #suggestionsByAgent = signal<
    Record<string, CopilotKitCoreGetSuggestionsResult>
  >({});
  readonly suggestionsByAgent = this.#suggestionsByAgent.asReadonly();

  readonly core = new CopilotKitCore({
    runtimeUrl: this.#config.runtimeUrl,
    headers: this.#config.headers,
    agents__unsafe_dev_only: {
      ...this.#config.agents,
      ...this.#config.selfManagedAgents,
    },
    tools: this.#config.tools,
    suggestionsConfig: this.#config.suggestionsConfig,
    properties: withA2UICatalogCapability(
      this.#config.properties,
      this.#config.a2ui?.catalog !== undefined,
    ),
  });

  readonly #toolCallRenderConfigs: WritableSignal<RenderToolCallConfig[]> =
    signal([]);
  readonly #builtInToolCallRenderConfigs: WritableSignal<
    RenderToolCallConfig[]
  > = signal([]);
  readonly #clientToolCallRenderConfigs: WritableSignal<FrontendToolConfig[]> =
    signal([]);
  readonly #builtInClientToolCallRenderConfigs: WritableSignal<
    FrontendToolConfig[]
  > = signal([]);
  readonly #humanInTheLoopToolRenderConfigs: WritableSignal<
    HumanInTheLoopConfig[]
  > = signal([]);
  readonly #activityMessageRenderConfigs: WritableSignal<
    RenderActivityMessageConfig[]
  > = signal([]);
  readonly #builtInActivityMessageRenderConfigs: WritableSignal<
    RenderActivityMessageConfig[]
  > = signal([]);

  readonly toolCallRenderConfigs: Signal<RenderToolCallConfig[]> = computed(
    () => [
      ...this.#toolCallRenderConfigs(),
      ...this.#builtInToolCallRenderConfigs(),
    ],
  );
  readonly clientToolCallRenderConfigs: Signal<FrontendToolConfig[]> = computed(
    () => [
      ...this.#clientToolCallRenderConfigs(),
      ...this.#builtInClientToolCallRenderConfigs(),
    ],
  );
  readonly humanInTheLoopToolRenderConfigs: Signal<HumanInTheLoopConfig[]> =
    this.#humanInTheLoopToolRenderConfigs.asReadonly();
  readonly activityMessageRenderConfigs: Signal<RenderActivityMessageConfig[]> =
    computed(() => [
      ...this.#activityMessageRenderConfigs(),
      ...this.#extensionActivityMessageRenderers,
      ...this.#builtInActivityMessageRenderConfigs(),
    ]);

  #openGenerativeUIToolRegistered = false;
  #openGenerativeUIContextIds: string[] = [];
  #a2UIContextIds: string[] = [];

  constructor() {
    ensureLicenseWatermark(this.#config.headers);

    this.#runtimeConnectionStatus.set(this.core.runtimeConnectionStatus);
    this.#runtimeUrl.set(this.core.runtimeUrl);
    this.#runtimeTransport.set(this.core.runtimeTransport);
    this.#headers.set(this.core.headers);
    this.#threadEndpoints.set(this.core.threadEndpoints);
    this.#intelligence.set(this.core.intelligence);
    this.#licenseStatus.set(this.core.licenseStatus);
    this.#config.renderToolCalls?.forEach((renderConfig) => {
      this.addRenderToolCall(renderConfig);
    });
    this.#config.renderActivityMessages?.forEach((renderConfig) => {
      this.addRenderActivityMessage(renderConfig);
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
        // Core assigns `threadEndpoints`/`intelligence` synchronously before it
        // notifies this callback (see agent-registry `ensureRuntimeMode`), so
        // mirroring them here keeps the signals in lockstep with the status
        // signal and lets reactive consumers observe `intelligence.wsUrl` once
        // `/info` resolves.
        this.#runtimeConnectionStatus.set(status);
        this.#threadEndpoints.set(this.core.threadEndpoints);
        this.#intelligence.set(this.core.intelligence);
        this.#licenseStatus.set(this.core.licenseStatus);
        this.#syncBuiltInActivityMessageRenderers();
        this.#syncBuiltInOpenGenerativeUI();
      },
      onHeadersChanged: ({ headers }) => {
        this.#headers.set(headers);
      },
      onSuggestionsChanged: ({ agentId, suggestions }) => {
        this.#setSuggestions(agentId, {
          suggestions,
          isLoading: this.core.getSuggestions(agentId).isLoading,
        });
      },
      onSuggestionsStartedLoading: ({ agentId }) => {
        this.#setSuggestions(agentId, {
          suggestions: this.core.getSuggestions(agentId).suggestions,
          isLoading: true,
        });
      },
      onSuggestionsFinishedLoading: ({ agentId }) => {
        this.#setSuggestions(agentId, {
          suggestions: this.core.getSuggestions(agentId).suggestions,
          isLoading: false,
        });
      },
    });
    this.#syncBuiltInActivityMessageRenderers();
    this.#syncBuiltInOpenGenerativeUI();
  }

  #setSuggestions(
    agentId: string,
    result: CopilotKitCoreGetSuggestionsResult,
  ): void {
    this.#suggestionsByAgent.update((current) => ({
      ...current,
      [agentId]: result,
    }));
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

  addRenderActivityMessage(renderConfig: RenderActivityMessageConfig): void {
    this.#activityMessageRenderConfigs.update((current) => [
      ...current,
      renderConfig,
    ]);
  }

  /** Remove one dynamically registered activity renderer by identity. */
  removeRenderActivityMessage(renderConfig: RenderActivityMessageConfig): void {
    this.#activityMessageRenderConfigs.update((current) =>
      current.filter((candidate) => candidate !== renderConfig),
    );
  }

  #syncBuiltInActivityMessageRenderers(): void {
    const renderers: RenderActivityMessageConfig[] = [];

    if (this.#isA2UIActive()) {
      renderers.push({
        activityType: "a2ui-surface",
        content: anyActivityContentSchema,
        component: CopilotA2UIActivityRenderer,
      });
    }

    if (this.#isOpenGenerativeUIActive()) {
      renderers.push({
        activityType: OPEN_GENERATIVE_UI_ACTIVITY_TYPE,
        content: anyActivityContentSchema,
        component: CopilotOpenGenerativeUIActivityRenderer,
      });
    }

    this.#builtInActivityMessageRenderConfigs.set(renderers);
    this.#syncBuiltInA2UI();
  }

  #syncBuiltInA2UI(): void {
    if (!this.#isA2UIActive()) {
      this.#builtInToolCallRenderConfigs.set([]);
      this.#removeA2UIContexts();
      return;
    }

    this.#builtInToolCallRenderConfigs.set([
      {
        name: RENDER_A2UI_TOOL_NAME,
        args: RenderA2UIArgsSchema,
        component: CopilotA2UIToolRenderer,
        passAgent: true,
      },
      {
        name: AGUI_SEND_STATE_SNAPSHOT_TOOL_NAME,
        args: RenderA2UIArgsSchema,
        component: CopilotA2UIToolRenderer,
        passAgent: true,
      },
    ]);
    this.#syncA2UIContexts();
  }

  #getA2UICatalog(): unknown {
    return this.#config.a2ui?.catalog;
  }

  /** Return whether runtime capability or an explicit catalog enables A2UI. */
  #isA2UIActive(): boolean {
    return this.core.a2uiEnabled || this.#getA2UICatalog() !== undefined;
  }

  #syncA2UIContexts(): void {
    this.#removeA2UIContexts();

    const catalog = this.#getA2UICatalog();
    this.#a2UIContextIds.push(
      this.core.addContext({
        description:
          "A2UI catalog capabilities: available catalog IDs and custom component definitions the client can render.",
        value: buildCatalogContextValue(catalog),
      }),
    );

    if (this.#config.a2ui?.includeSchema === false) return;

    this.#a2UIContextIds.push(
      this.core.addContext({
        description: A2UI_SCHEMA_CONTEXT_DESCRIPTION,
        value: JSON.stringify(extractCatalogComponentSchemas(catalog)),
      }),
    );
    this.#a2UIContextIds.push(
      this.core.addContext({
        description:
          "A2UI generation guidelines — protocol rules, tool arguments, path rules, data model format, and form/two-way-binding instructions.",
        value: A2UI_DEFAULT_GENERATION_GUIDELINES,
      }),
    );
    this.#a2UIContextIds.push(
      this.core.addContext({
        description:
          "A2UI design guidelines — visual design rules, component hierarchy tips, and action handler patterns.",
        value: A2UI_DEFAULT_DESIGN_GUIDELINES,
      }),
    );
  }

  #removeA2UIContexts(): void {
    for (const id of this.#a2UIContextIds) {
      this.core.removeContext(id);
    }
    this.#a2UIContextIds = [];
  }

  #isOpenGenerativeUIActive(): boolean {
    return !!this.#config.openGenerativeUI || this.core.openGenerativeUIEnabled;
  }

  #createOpenGenerativeUITool(): FrontendToolConfig<GenerateSandboxedUiArgs> & {
    injector: Injector;
  } {
    return {
      name: GENERATE_SANDBOXED_UI_TOOL_NAME,
      description: GENERATE_SANDBOXED_UI_DESCRIPTION,
      parameters: GenerateSandboxedUiArgsSchema,
      component: CopilotOpenGenerativeUIToolRenderer,
      handler: async () => "UI generated",
      followUp: true,
      injector: this.#rootInjector,
    };
  }

  #syncBuiltInOpenGenerativeUI(): void {
    const active = this.#isOpenGenerativeUIActive();

    if (!active) {
      this.#builtInClientToolCallRenderConfigs.set([]);
      this.#removeOpenGenerativeUIContexts();
      if (this.#openGenerativeUIToolRegistered) {
        this.core.removeTool(GENERATE_SANDBOXED_UI_TOOL_NAME);
        this.#openGenerativeUIToolRegistered = false;
      }
      return;
    }

    const builtInTool = this.#createOpenGenerativeUITool();
    this.#builtInClientToolCallRenderConfigs.set([builtInTool]);

    if (
      !this.#openGenerativeUIToolRegistered &&
      !this.core.getTool({ toolName: GENERATE_SANDBOXED_UI_TOOL_NAME })
    ) {
      this.core.addTool(this.#bindClientTool(builtInTool));
      this.#openGenerativeUIToolRegistered = true;
    }

    this.#syncOpenGenerativeUIContexts();
  }

  #syncOpenGenerativeUIContexts(): void {
    this.#removeOpenGenerativeUIContexts();

    const designSkill =
      this.#config.openGenerativeUI?.designSkill ??
      DEFAULT_OPEN_GENERATIVE_UI_DESIGN_SKILL;
    this.#openGenerativeUIContextIds.push(
      this.core.addContext({
        description:
          "Design guidelines for the generateSandboxedUi tool. Follow these when building UI.",
        value: designSkill,
      }),
    );

    const sandboxFunctions =
      this.#config.openGenerativeUI?.sandboxFunctions ?? [];
    if (!sandboxFunctions.length) return;

    const descriptors = JSON.stringify(
      sandboxFunctions.map((fn) => ({
        name: fn.name,
        description: fn.description,
        parameters: schemaToJsonSchema(fn.parameters, {
          zodToJsonSchema: standardSchemaZodToJsonSchema,
        }),
      })),
    );

    this.#openGenerativeUIContextIds.push(
      this.core.addContext({
        description:
          "Sandbox functions available in generated sandboxed UI code. Call via: await Websandbox.connection.remote.<functionName>(args)",
        value: descriptors,
      }),
    );
  }

  #removeOpenGenerativeUIContexts(): void {
    for (const id of this.#openGenerativeUIContextIds) {
      this.core.removeContext(id);
    }
    this.#openGenerativeUIContextIds = [];
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

  addSuggestionsConfig(config: SuggestionsConfig): string {
    return this.core.addSuggestionsConfig(config);
  }

  removeSuggestionsConfig(id: string): void {
    this.core.removeSuggestionsConfig(id);
  }

  reloadSuggestions(agentId: string): void {
    this.core.reloadSuggestions(agentId);
  }

  clearSuggestions(agentId: string): void {
    this.core.clearSuggestions(agentId);
  }

  getSuggestions(agentId: string): CopilotKitCoreGetSuggestionsResult {
    return (
      this.#suggestionsByAgent()[agentId] ?? this.core.getSuggestions(agentId)
    );
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
      this.core.setProperties(
        withA2UICatalogCapability(
          options.properties,
          this.#config.a2ui?.catalog !== undefined,
        ) ?? options.properties,
      );
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
