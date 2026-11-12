import type { AbstractAgent } from "@ag-ui/client";
import { isPlatformBrowser } from "@angular/common";
import type {
  FrontendTool,
  CopilotRuntimeTransport,
  CopilotKitCoreGetSuggestionsResult,
  CopilotKitHeadersSource,
  CopilotKitMessageFilter,
  SuggestionsConfig,
  ɵSuggestionsConfigInput,
  ɵCopilotKitCoreConfigPatch,
  ɵProviderConfigInput,
  ɵRuntimeInfo,
} from "@copilotkit/core";
import type { DebugConfig } from "@copilotkit/shared";
import { GENERATIVE_UI_ACTIVITY_TYPE } from "@copilotkit/shared";
import {
  CopilotKitCore,
  CopilotKitCoreRuntimeConnectionStatus,
  ɵbindSuggestionsConfig,
  ɵbuildHumanInTheLoopTool,
  ɵLearningAutoStarter,
  ɵRendererRegistry,
  ɵassembleActivityRenderers,
  ɵpublicKeyHeaderDefaults,
  ɵreportProviderConfigDiagnostics,
  ɵresolveProviderConfig,
  ɵwithHeaderDefaults,
} from "@copilotkit/core";
import type { Signal, WritableSignal } from "@angular/core";
import {
  DestroyRef,
  Injectable,
  Injector,
  PLATFORM_ID,
  computed,
  effect,
  isDevMode,
  runInInjectionContext,
  signal,
  inject,
  untracked,
} from "@angular/core";
import type {
  FrontendToolConfig,
  HumanInTheLoopConfig,
  RenderToolCallConfig,
} from "./tools";
import type { RenderActivityMessageConfig } from "./activity-renderer";
import {
  ɵCOPILOTKIT_BUILT_IN_ACTIVITY_RENDERERS,
  anyActivityContentSchema,
} from "./activity-renderer";
import { injectCopilotKitConfig } from "./config";
import type { CopilotKitConfig } from "./config";
import type { GenerateSandboxedUiArgs } from "./open-generative-ui";
import {
  GENERATE_SANDBOXED_UI_TOOL_NAME,
  OPEN_GENERATIVE_UI_ACTIVITY_TYPE,
} from "./open-generative-ui";
import {
  ɵaddOpenGenerativeUIContexts,
  ɵcreateOpenGenerativeUITool,
  ɵisOpenGenerativeUIActive,
} from "@copilotkit/core";
import { CopilotOpenGenerativeUIActivityRenderer } from "./components/open-generative-ui/open-generative-ui-activity-renderer";
import { CopilotOpenGenerativeUIToolRenderer } from "./components/open-generative-ui/open-generative-ui-tool-renderer";
import { CopilotInspector } from "./inspector";
import { COPILOT_CHAT_CONFIGURATION } from "./chat-configuration";
import { ɵOpenThreadBindings } from "./open-thread-bindings";

/** Map Angular's option names onto core's provider config input. */
function toProviderConfigInput(config: CopilotKitConfig): ɵProviderConfigInput {
  return {
    runtimeUrl: config.runtimeUrl,
    publicApiKey: config.licenseKey,
    runtimeTransport: config.runtimeTransport,
    agents__unsafe_dev_only: config.agents,
    selfManagedAgents: config.selfManagedAgents,
    properties: config.properties,
  };
}

@Injectable({ providedIn: "root" })
export class CopilotKit {
  readonly #config = injectCopilotKitConfig();
  readonly #extensionActivityMessageRenderers = inject(
    ɵCOPILOTKIT_BUILT_IN_ACTIVITY_RENDERERS,
  );
  readonly #rootInjector = inject(Injector);
  readonly #inspector = inject(CopilotInspector);
  /** Whether unknown tools may use the built-in text-only fallback renderer. */
  readonly defaultToolRenderingEnabled =
    this.#config.defaultToolRendering === true;
  readonly #agents = signal<Record<string, AbstractAgent>>(
    this.#config.agents ?? {},
  );
  readonly agents = this.#agents.asReadonly();
  /**
   * Core's runtime info snapshot (`core.ɵruntimeInfo`). Set in the
   * constructor, then on every change. The runtime signals below read it.
   */
  readonly #runtimeInfo = signal<ɵRuntimeInfo | undefined>(undefined);
  readonly runtimeConnectionStatus = computed(
    () =>
      this.#runtimeInfo()?.status ??
      CopilotKitCoreRuntimeConnectionStatus.Disconnected,
  );
  readonly #runtimeUrl = signal<string | undefined>(undefined);
  readonly runtimeUrl = this.#runtimeUrl.asReadonly();
  readonly #runtimeTransport = signal<CopilotRuntimeTransport>("auto");
  readonly runtimeTransport = this.#runtimeTransport.asReadonly();
  readonly #headers = signal<Record<string, string>>({});
  /**
   * Snapshot as of the last header SOURCE change (a `setHeaders()`/
   * `updateRuntime({ headers })` call) — not necessarily current for a
   * builder. It updates from `onHeadersChanged`, which fires only on a real
   * source change, never on a builder merely resolving a fresh token during a
   * run. With a builder this can read `{}` (or a stale record) between
   * source changes even though requests are already carrying the current
   * token (#1937). For the value a builder would resolve right now, call
   * `copilotkit.core.resolveHeaders()` instead.
   */
  readonly headers = this.#headers.asReadonly();
  readonly #headersGeneration = signal<number>(0);
  /**
   * Bumped only when `setHeaders` accepts a real source change (a new
   * builder identity, or a record whose normalized values actually differ) —
   * never when a builder merely resolves a new token. Set from
   * `onHeadersChanged`, which fires only from a real `setHeaders()` call, so
   * subscribers can key thread-context dispatch and agent header refresh on
   * this signal instead of on header VALUES (see #1937).
   */
  readonly ɵheadersGeneration = this.#headersGeneration.asReadonly();
  readonly #credentials = signal<RequestCredentials | undefined>(undefined);
  readonly credentials = this.#credentials.asReadonly();
  /**
   * Thread-endpoint capability advertised by the connected runtime's `/info`
   * response, or `undefined` before the runtime reports `Connected`. Exposed
   * as a signal (rather than a plain `core.threadEndpoints` read) so reactive
   * consumers re-run when `/info` lands.
   */
  readonly threadEndpoints = computed(
    () => this.#runtimeInfo()?.threadEndpoints,
  );
  /**
   * Voice transcription capability advertised by the connected runtime's
   * `/info` response. The value remains false until the runtime explicitly
   * reports support.
   */
  readonly audioFileTranscriptionEnabled = computed(
    () => this.#runtimeInfo()?.audioFileTranscriptionEnabled ?? false,
  );
  /**
   * Intelligence runtime info advertised by the connected runtime's `/info`
   * response, or `undefined` before the runtime reports `Connected`. Carries
   * the realtime `wsUrl`. Exposed as a signal so reactive consumers re-run
   * when `/info` populates it — even if the connection status does not
   * transition in the same turn.
   */
  readonly intelligence = computed(() => this.#runtimeInfo()?.intelligence);
  /**
   * Server-reported license status from the connected runtime's `/info`
   * response, or `undefined` before the runtime reports it. Exposed as a signal
   * (rather than a plain `core.licenseStatus` read) so reactive consumers — e.g.
   * the threads drawer's license gate — re-run once the status resolves.
   */
  readonly licenseStatus = computed(() => this.#runtimeInfo()?.licenseStatus);
  /**
   * Structured entitlement authority from the connected runtime's `/info`
   * response. Ready managed entitlements override legacy license status.
   */
  readonly runtimeEntitlements = computed(
    () => this.#runtimeInfo()?.runtimeEntitlements,
  );
  /**
   * Whether Core still owes the one bounded retry for a retryable entitlement
   * lookup. Gated UI stays pending until that retry settles.
   */
  readonly runtimeEntitlementRetryPending = computed(
    () => this.#runtimeInfo()?.runtimeEntitlementRetryPending ?? false,
  );
  readonly #suggestionsByAgent = signal<
    Record<string, CopilotKitCoreGetSuggestionsResult>
  >({});
  readonly suggestionsByAgent = this.#suggestionsByAgent.asReadonly();

  /**
   * The provider inputs core normalizes (key fallback, Copilot Cloud URL,
   * transport, agent merge). `updateRuntime` replaces the
   * keys it is given and resolves again.
   */
  #providerInput = toProviderConfigInput(this.#config);
  readonly #initialConfig = ɵresolveProviderConfig(this.#providerInput);
  /** The public-key header default. The key is fixed for this instance. */
  readonly #publicKeyDefaults = ɵpublicKeyHeaderDefaults(
    this.#initialConfig.publicKey,
  );

  // `ɵwithHeaderDefaults` returns a new function for a function source on
  // every call. Remember the last source and its wrapper, so passing the same
  // builder again hands core the same function and stays a no-op (#1937).
  #lastHeadersSource: CopilotKitHeadersSource | undefined;
  readonly #loggedDiagnostics = new Set<string>();
  #lastWrappedHeaders: CopilotKitHeadersSource | undefined;

  #withPublicKeyDefaults(
    source: CopilotKitHeadersSource,
  ): CopilotKitHeadersSource {
    if (source !== this.#lastHeadersSource) {
      this.#lastHeadersSource = source;
      this.#lastWrappedHeaders = ɵwithHeaderDefaults(
        source,
        this.#publicKeyDefaults,
      );
    }
    return this.#lastWrappedHeaders!;
  }

  readonly core = new CopilotKitCore({
    runtimeUrl: this.#initialConfig.runtimeUrl,
    runtimeTransport: this.#initialConfig.runtimeTransport,
    // `/info` starts in the constructor, and only in the browser, so server
    // rendering never fetches it.
    deferInitialConnection: true,
    headers: this.#withPublicKeyDefaults(this.#config.headers ?? {}),
    credentials: this.#config.credentials,
    messageFilter: this.#config.messageFilter,
    agents__unsafe_dev_only: this.#initialConfig.agents,
    tools: this.#config.tools,
    suggestionsConfig: this.#config.suggestionsConfig,
    properties: this.#initialConfig.properties,
    debug: this.#config.debug,
    defaultThrottleMs: this.#config.defaultThrottleMs,
    onError: this.#config.onError,
  });

  /**
   * App tool-call renderers and activity renderers. Config renderers are the
   * prop list; `addRenderToolCall` adds hook entries, so the latest
   * registration for a name and agent wins.
   */
  readonly #renderers = new ɵRendererRegistry<
    RenderToolCallConfig,
    RenderActivityMessageConfig,
    never
  >();
  readonly #toolCallRenderConfigs = signal(this.#renderers.toolCalls);
  readonly #clientToolCallRenderConfigs: WritableSignal<FrontendToolConfig[]> =
    signal([]);
  readonly #builtInClientToolCallRenderConfigs: WritableSignal<
    FrontendToolConfig[]
  > = signal([]);
  readonly #humanInTheLoopToolRenderConfigs: WritableSignal<
    HumanInTheLoopConfig[]
  > = signal([]);
  readonly #activityMessageRenderConfigs = signal(this.#renderers.activity);
  readonly #builtInActivityMessageRenderConfigs: WritableSignal<
    RenderActivityMessageConfig[]
  > = signal([]);

  readonly toolCallRenderConfigs: Signal<RenderToolCallConfig[]> = computed(
    () => [...this.#toolCallRenderConfigs()],
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

  readonly #executingToolCallIds = signal(this.core.executingToolCallIds);
  /**
   * Ids of the tool calls whose frontend handler runs now. Mirrors
   * `core.executingToolCallIds`: a call stays in it until its result is in
   * the agent's messages.
   */
  readonly executingToolCallIds = this.#executingToolCallIds.asReadonly();

  /** Removes the built-in Open Generative UI tool, while it is registered. */
  #unregisterOpenGenerativeUITool: (() => void) | undefined;
  #removeOpenGenerativeUIContexts: (() => void) | undefined;
  #warnedMissingGenerativeUI = false;

  constructor() {
    // Chat configurations register their shown Thread with this core.
    const openThreads = inject(ɵOpenThreadBindings);
    openThreads.attach(this.core);
    // This service creates `core`, so it owns it and stops it on destroy.
    inject(DestroyRef).onDestroy(() => {
      openThreads.attach(undefined);
      this.core.dispose();
    });
    // Throws in production for a missing runtime config; otherwise warns.
    ɵreportProviderConfigDiagnostics(this.#initialConfig.diagnostics, {
      isProduction: !isDevMode(),
      logged: this.#loggedDiagnostics,
    });
    void this.#inspector.isInspectorEnabled;
    this.#startLearning();

    this.#runtimeInfo.set(this.core.ɵruntimeInfo);
    this.core.ɵsubscribeToRuntimeInfo(() => {
      this.#runtimeInfo.set(this.core.ɵruntimeInfo);
    });
    this.#runtimeUrl.set(this.core.runtimeUrl);
    this.#runtimeTransport.set(this.core.runtimeTransport);
    this.#headers.set(this.core.headers);
    this.#headersGeneration.set(this.core.ɵheadersGeneration);
    this.#credentials.set(this.core.credentials);
    this.#renderers.subscribe((kind) => {
      if (kind === "toolCalls") {
        this.#toolCallRenderConfigs.set(this.#renderers.toolCalls);
      } else if (kind === "activity") {
        this.#activityMessageRenderConfigs.set(this.#renderers.activity);
      }
    });
    const configToolRenderers: RenderToolCallConfig[] = (
      this.#config.tools ?? []
    ).flatMap((tool) =>
      tool.renderer && tool.parameters
        ? [
            {
              name: tool.name,
              args: tool.parameters,
              component: tool.renderer,
              agentId: tool.agentId,
            },
          ]
        : [],
    );
    this.#renderers.setPropToolCalls([
      ...(this.#config.renderToolCalls ?? []),
      ...configToolRenderers,
    ]);
    this.#renderers.setActivity(this.#config.renderActivityMessages ?? []);

    this.#config.frontendTools?.forEach((clientTool) => {
      this.addFrontendTool({ ...clientTool, injector: this.#rootInjector });
    });

    this.#config.humanInTheLoop?.forEach((humanInTheLoopTool) => {
      this.addHumanInTheLoop(humanInTheLoopTool);
    });

    // The core constructor registers dev agents without announcing them, so
    // its run tracking (per-run state, subagents) never subscribes to them.
    // Publish them once, as the React provider does on mount.
    const devAgents = this.#initialConfig.agents;
    if (Object.keys(devAgents).length > 0) {
      this.core.setAgents__unsafe_dev_only(devAgents);
    }

    this.core.subscribe({
      onAgentsChanged: () => {
        this.#agents.set(this.core.agents);
      },
      onExecutingToolCallsChanged: ({ executingToolCallIds }) => {
        this.#executingToolCallIds.set(executingToolCallIds);
      },
      // The runtime signals follow `ɵsubscribeToRuntimeInfo` above, which
      // core updates before it notifies this callback.
      onRuntimeConnectionStatusChanged: () => {
        this.#syncBuiltInActivityMessageRenderers();
        this.#syncBuiltInOpenGenerativeUI();
        this.#warnIfGenerativeUIMissing();
      },
      onHeadersChanged: ({ headers }) => {
        this.#headers.set(headers);
        // Fires only from a real `setHeaders()` call (a new source), never
        // from a builder resolving a new token — same generation core bumps.
        // Without this, nothing pokes Angular's reactivity when a source
        // change lands: `ɵheadersGeneration` (core's) is a plain property
        // read, not a signal, so `ɵheadersGeneration`-keyed dependents
        // (threads.ts, agent.ts) only re-read it when this handler sets ours.
        this.#headersGeneration.set(this.core.ɵheadersGeneration);
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
    if (isPlatformBrowser(inject(PLATFORM_ID))) {
      this.core.connect();
    }
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

    // A display-only registration declares no handler, and core has its own path
    // for that: it inserts an empty tool result and completes the turn. Binding a
    // wrapper here regardless would call `undefined` on the first tool call, and
    // substituting a stub would put an invented result into the thread instead.
    if (!handler) {
      return frontendCandidate;
    }

    return {
      ...frontendCandidate,
      handler: (args, context) =>
        runInInjectionContext(injector, () => handler(args, context)),
    };
  }

  /**
   * Register a frontend tool, and the component that draws its calls when it
   * has one.
   *
   * A tool with the same name and `agentId` as an existing tool (from the
   * `tools` config or an earlier registration) hides that tool. The latest
   * registration runs. Among frontend tools with that name, its component
   * draws the calls.
   *
   * @param clientToolWithInjector - The tool, plus the injector its handler
   *   runs in.
   * @returns A function that removes only this registration. The tool it hid
   *   becomes active again. Calling it more than once does nothing.
   *
   * @example
   * ```ts
   * const unregister = copilotKit.addFrontendTool({ ...tool, injector });
   * // later
   * unregister();
   * ```
   */
  addFrontendTool(
    clientToolWithInjector: FrontendToolConfig & {
      injector: Injector;
    },
  ) {
    const tool = this.#bindClientTool(clientToolWithInjector);
    const unregisterTool = this.core.addTool(tool);

    // Newest first, so the drawn component belongs to the tool core runs.
    this.#clientToolCallRenderConfigs.update((current) => [
      clientToolWithInjector,
      ...current,
    ]);

    return () => {
      unregisterTool();
      this.#clientToolCallRenderConfigs.update((current) =>
        current.filter((candidate) => candidate !== clientToolWithInjector),
      );
    };
  }

  /**
   * Register a component that draws calls of a tool the agent already has.
   *
   * It replaces a renderer with the same `name` and `agentId`, so the latest
   * registration wins, as in React and Vue.
   *
   * @param renderConfig - The tool name, its argument schema, and the
   *   component.
   * @returns A function that removes this renderer while it is still the one
   *   registered for its name and agent. A `renderToolCalls` config entry it
   *   replaced shows again. Calling it more than once does nothing.
   */
  addRenderToolCall(renderConfig: RenderToolCallConfig) {
    return this.#renderers.addHookToolCall(renderConfig);
  }

  addRenderActivityMessage(renderConfig: RenderActivityMessageConfig): void {
    this.#renderers.setActivity([...this.#renderers.activity, renderConfig]);
  }

  /** Remove one dynamically registered activity renderer by identity. */
  removeRenderActivityMessage(renderConfig: RenderActivityMessageConfig): void {
    this.#renderers.setActivity(
      this.#renderers.activity.filter(
        (candidate) => candidate !== renderConfig,
      ),
    );
  }

  #syncBuiltInActivityMessageRenderers(): void {
    this.#builtInActivityMessageRenderConfigs.set(
      ɵassembleActivityRenderers<RenderActivityMessageConfig>({
        builtIns: [
          this.#isOpenGenerativeUIActive() && {
            activityType: OPEN_GENERATIVE_UI_ACTIVITY_TYPE,
            content: anyActivityContentSchema,
            component: CopilotOpenGenerativeUIActivityRenderer,
          },
        ],
      }),
    );
  }

  /**
   * The runtime turns generative UI on, but nothing in the app renders its
   * surfaces. React and Vue fall back to `standardUI` here. Angular cannot:
   * `@copilotkit/angular/generative-ui` imports this entry, so this entry
   * cannot load it, not even lazily (ng-packagr rejects the cycle). The app
   * opts in with `provideGenerativeUI`, which registers the surface
   * renderer, so a missing renderer means a missing provider.
   */
  #warnIfGenerativeUIMissing(): void {
    if (this.#warnedMissingGenerativeUI || !isDevMode()) return;
    if (!this.core.ɵruntimeInfo.generativeUIEnabled) return;
    const rendered = [
      ...this.#extensionActivityMessageRenderers,
      ...this.#renderers.activity,
    ].some((renderer) => renderer.activityType === GENERATIVE_UI_ACTIVITY_TYPE);
    if (rendered) return;
    this.#warnedMissingGenerativeUI = true;
    console.warn(
      "[CopilotKit] The runtime turns generative UI on, but no generative UI is set up, so its surfaces do not render. " +
        "Add `provideGenerativeUI({ ui: standardUI })` from `@copilotkit/angular/generative-ui` to the application providers.",
    );
  }

  #isOpenGenerativeUIActive(): boolean {
    return ɵisOpenGenerativeUIActive({
      runtimeEnabled: this.core.ɵruntimeInfo.openGenerativeUIEnabled,
      configured: !!this.#config.openGenerativeUI,
    });
  }

  /** Register sandbox rendering with a side-effect-free acknowledgement safe to replay. */
  #createOpenGenerativeUITool(): FrontendToolConfig<GenerateSandboxedUiArgs> & {
    injector: Injector;
  } {
    return {
      ...ɵcreateOpenGenerativeUITool(),
      component: CopilotOpenGenerativeUIToolRenderer,
      injector: this.#rootInjector,
    };
  }

  #syncBuiltInOpenGenerativeUI(): void {
    const active = this.#isOpenGenerativeUIActive();

    if (!active) {
      this.#builtInClientToolCallRenderConfigs.set([]);
      this.#removeOpenGenerativeUIContexts?.();
      this.#removeOpenGenerativeUIContexts = undefined;
      this.#unregisterOpenGenerativeUITool?.();
      this.#unregisterOpenGenerativeUITool = undefined;
      return;
    }

    const builtInTool = this.#createOpenGenerativeUITool();
    this.#builtInClientToolCallRenderConfigs.set([builtInTool]);

    const needsBuiltInTool =
      this.#unregisterOpenGenerativeUITool === undefined &&
      !this.core.getTool({ toolName: GENERATE_SANDBOXED_UI_TOOL_NAME });
    if (needsBuiltInTool) {
      this.#unregisterOpenGenerativeUITool = this.core.addTool(
        this.#bindClientTool(builtInTool),
      );
    }

    this.#removeOpenGenerativeUIContexts?.();
    this.#removeOpenGenerativeUIContexts = ɵaddOpenGenerativeUIContexts(
      this.core,
      {
        designSkill: this.#config.openGenerativeUI?.designSkill,
        sandboxFunctions: this.#config.openGenerativeUI?.sandboxFunctions ?? [],
      },
    );
  }

  /**
   * Register a human-in-the-loop tool and the component that asks the user.
   *
   * A tool with the same name and `agentId` as an existing tool hides that
   * tool. The latest registration runs. Among human-in-the-loop tools with
   * that name, its component draws the calls.
   *
   * @param humanInTheLoopTool - The tool and its component.
   * @returns A function that removes only this registration. The tool it hid
   *   becomes active again. Calling it more than once does nothing.
   */
  addHumanInTheLoop(humanInTheLoopTool: HumanInTheLoopConfig) {
    // Newest first, so the drawn component belongs to the tool core runs.
    this.#humanInTheLoopToolRenderConfigs.update((current) => [
      humanInTheLoopTool,
      ...current,
    ]);

    const tool = ɵbuildHumanInTheLoopTool(
      humanInTheLoopTool,
      this.core.ɵhumanInTheLoop,
    );
    const unregisterTool = this.core.addTool(tool);

    return () => {
      unregisterTool();
      this.#humanInTheLoopToolRenderConfigs.update((current) =>
        current.filter((candidate) => candidate !== humanInTheLoopTool),
      );
    };
  }

  /** Applies `config.learning` in the browser; capture stops on destroy. */
  #startLearning() {
    const { learning } = this.#config;
    if (learning === undefined || !isPlatformBrowser(inject(PLATFORM_ID))) {
      return;
    }
    const learningStarter = new ɵLearningAutoStarter(this.core);
    learningStarter.update(learning);
    inject(DestroyRef).onDestroy(() => learningStarter.dispose());
  }

  addSuggestionsConfig(config: SuggestionsConfig): string {
    return this.core.addSuggestionsConfig(config);
  }

  /**
   * Registers a suggestions config for as long as the calling context lives:
   * the Angular counterpart of `useConfigureSuggestions` in React and Vue.
   *
   * Call it in an injection context (a constructor or field initializer), or
   * pass `injector`. A global config (no `consumerAgentId`, or `"*"`) loads
   * for the surrounding chat configuration's agent and every idle agent. The
   * config is removed when that context is destroyed or `dispose()` is called.
   * Pass a function to re-apply the config when signals it reads change;
   * configs with equal content are no-ops.
   *
   * @example
   * readonly suggestions = inject(CopilotKit).configureSuggestions(() => ({
   *   instructions: `Suggest next steps about ${this.topic()}`,
   *   available: "always",
   * }));
   */
  configureSuggestions(
    config:
      | ɵSuggestionsConfigInput
      | null
      | undefined
      | (() => ɵSuggestionsConfigInput | null | undefined),
    options: { injector?: Injector } = {},
  ) {
    const injector = options.injector ?? inject(Injector);
    const chatConfig = injector.get(COPILOT_CHAT_CONFIGURATION, null);
    const readConfig = typeof config === "function" ? config : () => config;
    const readChatAgentId = () => chatConfig?.agentId();
    const binding = ɵbindSuggestionsConfig(this.core, untracked(readConfig), {
      chatAgentId: untracked(readChatAgentId),
    });
    const watcher = effect(
      () => {
        const next = readConfig();
        const chatAgentId = readChatAgentId();
        untracked(() => binding.update(next, { chatAgentId }));
      },
      { injector },
    );
    const dispose = () => {
      watcher.destroy();
      binding.dispose();
    };
    injector.get(DestroyRef).onDestroy(dispose);
    return { reload: () => binding.reload(), dispose };
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

  /**
   * Remove every tool and renderer with this name.
   *
   * With an `agentId`, only entries for that agent go. Without one, only
   * global entries go. This also removes a tool from the `tools` config with
   * that name. To remove one registration and bring back the tool it hid,
   * call the function that `addFrontendTool`, `addHumanInTheLoop`, or
   * `addRenderToolCall` returned.
   *
   * @param toolName - The tool name.
   * @param agentId - The agent the entries belong to. Omit it for global
   *   entries.
   */
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
    this.#renderers.removeToolCall(toolName, agentId);
  }

  getAgent(agentId: string): AbstractAgent | undefined {
    return this.core.getAgent(agentId);
  }

  /**
   * Change the runtime config after startup.
   *
   * A key that is present is applied. `runtimeUrl`, `credentials`,
   * `messageFilter`, `debug` and `defaultThrottleMs` can be cleared by
   * passing `undefined`; the other keys are ignored when `undefined`.
   * `agents` and `selfManagedAgents` replace the last value of that key.
   */
  updateRuntime(options: {
    runtimeUrl?: string;
    runtimeTransport?: CopilotRuntimeTransport;
    headers?: CopilotKitHeadersSource;
    credentials?: RequestCredentials;
    messageFilter?: CopilotKitMessageFilter;
    properties?: Record<string, unknown>;
    agents?: Record<string, AbstractAgent>;
    selfManagedAgents?: Record<string, AbstractAgent>;
    debug?: DebugConfig;
    defaultThrottleMs?: number;
  }): void {
    const hasRuntimeUrl = "runtimeUrl" in options;
    const hasTransport = options.runtimeTransport !== undefined;
    const hasProperties = options.properties !== undefined;
    const hasAgents =
      options.agents !== undefined || options.selfManagedAgents !== undefined;
    this.#providerInput = {
      ...this.#providerInput,
      ...(hasRuntimeUrl && { runtimeUrl: options.runtimeUrl }),
      ...(hasTransport && { runtimeTransport: options.runtimeTransport }),
      ...(hasProperties && { properties: options.properties }),
      ...(options.agents !== undefined && {
        agents__unsafe_dev_only: options.agents,
      }),
      ...(options.selfManagedAgents !== undefined && {
        selfManagedAgents: options.selfManagedAgents,
      }),
    };
    const resolved = ɵresolveProviderConfig(this.#providerInput);

    const patch: ɵCopilotKitCoreConfigPatch = {};
    // `in`, not `!== undefined`: clearing these is a real instruction, and
    // `undefined` is the value that expresses it.
    if ("messageFilter" in options) patch.messageFilter = options.messageFilter;
    if (hasRuntimeUrl) patch.runtimeUrl = resolved.runtimeUrl;
    if (hasTransport) patch.runtimeTransport = resolved.runtimeTransport;
    if (options.headers !== undefined) {
      patch.headers = this.#withPublicKeyDefaults(options.headers);
    }
    if ("credentials" in options) patch.credentials = options.credentials;
    if (hasProperties) patch.properties = resolved.properties;
    if (hasAgents) patch.agents__unsafe_dev_only = resolved.agents;
    if ("debug" in options) patch.debug = options.debug;
    if ("defaultThrottleMs" in options) {
      patch.defaultThrottleMs = options.defaultThrottleMs;
    }
    this.core.ɵupdateConfig(patch);

    if (hasRuntimeUrl) this.#runtimeUrl.set(resolved.runtimeUrl);
    if (hasTransport) this.#runtimeTransport.set(resolved.runtimeTransport);
    if (options.headers !== undefined) this.#headers.set(this.core.headers);
    if ("credentials" in options) this.#credentials.set(options.credentials);
  }
}
