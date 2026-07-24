<script lang="ts">
  import { z } from "zod";
  import { CopilotKitCoreSvelte } from "../lib/svelte-core";
  import type {
    FrontendTool,
    CopilotKitCoreRuntimeConnectionStatus,
    CopilotRuntimeTransport,
    IntelligenceRuntimeInfo,
    RuntimeLicenseStatus,
    ThreadEndpointRuntimeInfo,
  } from "@copilotkit/core";
  import { CopilotKitCoreRuntimeConnectionStatus as CoreStatus } from "@copilotkit/core";
  import { setContext } from "svelte";
  import { COPILOT_KIT_KEY } from "./context";
  import type { CopilotKitProviderProps } from "./CopilotKitProvider.types";
  import type {
    SvelteToolCallRenderer,
    SvelteFrontendTool,
  } from "../types";
  import type { AbstractAgent } from "@ag-ui/client";

  // Provider-level TODOs (place implementations here, not in CopilotKitCoreSvelte):
  //
  // 1. A2UI built-in renderer auto-registration
  //    When core.a2uiEnabled becomes true on runtime connection, register:
  //      - render_a2ui / AGUISendStateSnapshot → CopilotA2UIToolRenderer
  //      - a2ui-surface → CopilotA2UIActivityRenderer
  //      - A2UI catalog/schema/guidelines contexts via core.addContext()
  //    See packages/angular/src/lib/copilotkit.ts #syncBuiltInA2UI / #syncA2UIContexts
  //
  // 2. OpenGenerativeUI built-in registration
  //    When openGenerativeUI config or core.openGenerativeUIEnabled, register:
  //      - generateSandboxedUi tool + CopilotOpenGenerativeUIToolRenderer
  //      - open-generative-ui activity renderer
  //      - design skill + sandbox function contexts via core.addContext()
  //    See packages/angular/src/lib/copilotkit.ts #syncBuiltInOpenGenerativeUI
  //
  // 3. License watermark
  //    Insert a watermark DOM element when publicApiKey is present but invalid.
  //    See packages/angular/src/lib/license-watermark.ts ensureLicenseWatermark
  //
  // 4. removeTool that also cleans up render configs
  //    Override removeTool(name, agentId) to also filter the entry out of
  //    all render config lists (tool call, frontend tool, HITL renderers).
  //    Use $state arrays so consumers see the removal reactively.
  //    See Angular's CopilotKit.removeTool().
  //
  // 5. updateRuntime batch method
  //    Expose a method (or $derived effect) that batches runtimeUrl,
  //    runtimeTransport, headers, properties, and agents updates into
  //    single calls to the core, updating reactive $state in lockstep.
  //    See Angular's CopilotKit.updateRuntime().
  //
  // 6. addFrontendTool / addRenderToolCall / addRenderActivityMessage / addHumanInTheLoop
  //    Provider-level methods that register a tool on the core AND track
  //    the render config in local $state arrays. HITL tools need a
  //    promise-based handler wired to the render component's respond().
  //    See Angular's CopilotKit.addFrontendTool / addHumanInTheLoop / etc.
  //
  // 7. Tool-to-renderer auto-bridge
  //    When a frontend tool has .render and .parameters, automatically
  //    create a tool call render config from it. Partially done below
  //    for prop-registered tools; hook-registered tools (registerFrontendTool)
  //    handle their own renderer via addHookRenderToolCall.
  //
  // 8. Suggestions reactive state
  //    Wire up onSuggestionsChanged / onSuggestionsStartedLoading /
  //    onSuggestionsFinishedLoading in the subscription block below to
  //    populate a $state<Record<string, {suggestions, isLoading}>> map.
  //    See Angular's CopilotKit #setSuggestions.

  let {
    runtimeUrl,
    headers = {},
    credentials,
    defaultThrottleMs,
    publicApiKey,
    publicLicenseKey,
    properties = {},
    useSingleEndpoint,
    agents__unsafe_dev_only = {},
    selfManagedAgents = {},
    renderToolCalls = [],
    renderActivityMessages = [],
    renderCustomMessages = [],
    frontendTools = [],
    humanInTheLoop = [],
    openGenerativeUI,
    showDevConsole = false,
    onError,
    a2ui,
    debug,
    children,
  }: CopilotKitProviderProps & { children?: any } = $props();

  const HEADER_NAME = "X-CopilotCloud-Public-Api-Key";
  const COPILOT_CLOUD_CHAT_URL =
    "https://api.cloud.copilotkit.ai/copilotkit/v1";

  const resolvedPublicKey = $derived(publicApiKey ?? publicLicenseKey);
  const mergedAgents = $derived({
    ...agents__unsafe_dev_only,
    ...selfManagedAgents,
  });
  const hasLocalAgents = $derived(Object.keys(mergedAgents).length > 0);

  const resolvedHeaders = $derived(
    typeof headers === "function" ? headers() : headers,
  );
  const mergedHeaders = $derived.by(() => {
    const h = { ...resolvedHeaders };
    if (resolvedPublicKey && !h[HEADER_NAME]) {
      h[HEADER_NAME] = resolvedPublicKey;
    }
    return h;
  });

  const chatApiEndpoint = $derived(
    runtimeUrl ?? (resolvedPublicKey ? COPILOT_CLOUD_CHAT_URL : undefined),
  );

  const a2uiCatalogProvided = $derived(!!a2ui?.catalog);
  const resolvedProperties = $derived(
    a2uiCatalogProvided
      ? { ...properties, a2uiCatalogAvailable: true }
      : properties,
  );

  const processedHumanInTheLoop = $derived.by(() => {
    const tools: FrontendTool[] = [];
    const renderToolCallsArr: SvelteToolCallRenderer<unknown>[] = [];

    for (const tool of humanInTheLoop) {
      tools.push({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
        followUp: tool.followUp,
        ...(tool.agentId && { agentId: tool.agentId }),
        handler: async () => {
          console.warn(
            `Human-in-the-loop tool '${tool.name}' called but no interactive handler is set up.`,
          );
          return undefined;
        },
      });
      if (tool.render) {
        renderToolCallsArr.push({
          name: tool.name,
          args: tool.parameters ?? z.any(),
           // TODO: Fix type incompatibility between SvelteHumanInTheLoopRenderFn and SvelteToolCallRendererRenderFn.
    // Human-in-the-loop renderers expect 'description' and 'respond' parameters.
    // Tracked in Provider Task #6 / #7.
          render: tool.render,
          ...(tool.agentId && { agentId: tool.agentId }),
        } as unknown as SvelteToolCallRenderer<unknown>);
      }
    }
    return { tools, renderToolCalls: renderToolCallsArr };
  });

  const allTools = $derived.by(() => {
    const tools: FrontendTool[] = [...frontendTools];
    tools.push(...processedHumanInTheLoop.tools);
    return tools;
  });

  const allRenderToolCalls = $derived.by(() => {
    const combined: SvelteToolCallRenderer<unknown>[] = [...renderToolCalls];
    for (const tool of frontendTools) {
      if (tool.render) {
        const args =
          tool.parameters ?? (tool.name === "*" ? z.any() : undefined);
        if (args) {
          combined.push({
            name: tool.name,
            args,
            render: tool.render,
          } as SvelteToolCallRenderer<unknown>);
        }
      }
    }
    combined.push(...processedHumanInTheLoop.renderToolCalls);
    return combined;
  });

  // ── Reactive state (mirrors Angular's CopilotKit service signals) ──
  let agents = $state<Record<string, AbstractAgent>>({});
  let runtimeConnectionStatus = $state<CopilotKitCoreRuntimeConnectionStatus>(
    CoreStatus.Disconnected,
  );
  let reactiveRuntimeUrl = $state<string | undefined>(undefined);
  let reactiveRuntimeTransport = $state<CopilotRuntimeTransport>("auto");
  let reactiveHeaders = $state<Record<string, string>>({});
  let threadEndpoints = $state<ThreadEndpointRuntimeInfo | undefined>(undefined);
  let intelligence = $state<IntelligenceRuntimeInfo | undefined>(undefined);
  let licenseStatus = $state<RuntimeLicenseStatus | undefined>(undefined);

  // Stable reference — never wrapped in $state (deep proxy breaks Set/Map/Array internals).
  // Created with empty config; all reactive props are pushed via $effect setters below.
  // $effect automatically tracks $derived dependencies, so there are no stale snapshots
  // and no "state_referenced_locally" warnings.
  let copilotkit = new CopilotKitCoreSvelte({});

  // Apply runtimeUrl synchronously so child effects (e.g. createAgent) can
  // read it immediately without waiting for the first $effect pass.
  // svelte-ignore state_referenced_locally
  const initialEndpoint =
    runtimeUrl ?? (resolvedPublicKey ? COPILOT_CLOUD_CHAT_URL : undefined);
  if (initialEndpoint) {
    copilotkit.setRuntimeUrl(initialEndpoint);
    reactiveRuntimeUrl = initialEndpoint;
  }
  let executingToolCallIds = $state<ReadonlySet<string>>(new Set());

  // ── Context Registration (BEFORE any $effect blocks!) ──
  // setContext must be called during synchronous component initialization.
  // If placed after $effect blocks, the compiler may hoist it outside the
  // initialization scope, causing "lifecycle_outside_component".
  setContext(COPILOT_KIT_KEY, {
    get copilotkit() { return copilotkit; },
    get executingToolCallIds() { return executingToolCallIds; },
    get agents() { return agents; },
    get runtimeConnectionStatus() { return runtimeConnectionStatus; },
    get runtimeUrl() { return reactiveRuntimeUrl; },
    get runtimeTransport() { return reactiveRuntimeTransport; },
    get headers() { return reactiveHeaders; },
    get threadEndpoints() { return threadEndpoints; },
    get intelligence() { return intelligence; },
    get licenseStatus() { return licenseStatus; },
  });

  // ── Unified Core Configuration Sync ──
  // Grouping guarantees that if multiple props change at once (e.g. runtime URL + headers),
  // the updates are cleanly batched into the core engine together, matching Angular's
  // updateRuntime() pattern rather than React's per-concern separate effects.
  $effect(() => {
    const transport: CopilotRuntimeTransport =
      useSingleEndpoint === true
        ? "single"
        : useSingleEndpoint === false
          ? "rest"
          : "auto";

    copilotkit.setRuntimeUrl(chatApiEndpoint);
    copilotkit.setRuntimeTransport(transport);
    copilotkit.setHeaders(mergedHeaders);
    copilotkit.setCredentials(credentials);
    copilotkit.setProperties(resolvedProperties);
    copilotkit.setAgents__unsafe_dev_only(mergedAgents);
    copilotkit.setDebug(debug);
    copilotkit.setTools(allTools);
    copilotkit.setRenderToolCalls(allRenderToolCalls);
    copilotkit.setRenderCustomMessages(renderCustomMessages);
    copilotkit.setRenderActivityMessages(renderActivityMessages);

    if (defaultThrottleMs !== undefined) {
      copilotkit.setDefaultThrottleMs(defaultThrottleMs);
    }
  });

  $effect(() => {
    agents = copilotkit.agents;
    runtimeConnectionStatus = copilotkit.runtimeConnectionStatus;
    reactiveRuntimeUrl = copilotkit.runtimeUrl;
    reactiveRuntimeTransport = copilotkit.runtimeTransport;
    reactiveHeaders = copilotkit.headers;
    threadEndpoints = copilotkit.threadEndpoints;
    intelligence = copilotkit.intelligence;
    licenseStatus = copilotkit.licenseStatus;
  });

  $effect(() => {
    const core = copilotkit;
    const sub1 = core.subscribe({
      onToolExecutionStart: ({ toolCallId }) => {
        executingToolCallIds = new Set(executingToolCallIds).add(toolCallId);
      },
      onToolExecutionEnd: ({ toolCallId }) => {
        const next = new Set(executingToolCallIds);
        next.delete(toolCallId);
        executingToolCallIds = next;
      },
    });
    const sub2 = core.subscribe({
      onRenderToolCallsChanged: () => {},
    });
    const sub3 = core.subscribe({
      onRenderCustomMessagesChanged: () => {},
    });
    const sub4 = core.subscribe({
      onRuntimeConnectionStatusChanged: ({ status }) => {
        runtimeConnectionStatus = status;
        threadEndpoints = core.threadEndpoints;
        intelligence = core.intelligence;
        licenseStatus = core.licenseStatus;
        reactiveRuntimeUrl = core.runtimeUrl;
        reactiveRuntimeTransport = core.runtimeTransport;
        reactiveHeaders = core.headers;
      },
      onAgentsChanged: ({ agents: newAgents }) => {
        agents = { ...newAgents };
      },
      onHeadersChanged: ({ headers: newHeaders }) => {
        reactiveHeaders = newHeaders;
      },
    });
    const sub5 = core.subscribe({
      onError: (event) => {
        onError?.(event);
      },
    });

    return () => {
      sub1.unsubscribe();
      sub2.unsubscribe();
      sub3.unsubscribe();
      sub4.unsubscribe();
      sub5.unsubscribe();
    };
  });

</script>

{@render children()}
