<script lang="ts">
  import { setContext } from "svelte";
  import { z } from "zod";
  import { CopilotKitCoreSvelte } from "../lib/svelte-core";
  import type { FrontendTool } from "@copilotkit/core";
  import { COPILOT_KIT_KEY } from "./context";
  import type { CopilotKitProviderProps } from "./CopilotKitProvider.types";
  import type {
    SvelteToolCallRenderer,
    SvelteFrontendTool,
  } from "../types";

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
          render: tool.render,
          ...(tool.agentId && { agentId: tool.agentId }),
        } as SvelteToolCallRenderer<unknown>);
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

  const createCopilotKit = () => {
    const core = new CopilotKitCoreSvelte({
      runtimeUrl: chatApiEndpoint,
      runtimeTransport:
        useSingleEndpoint === true
          ? "single"
          : useSingleEndpoint === false
            ? "rest"
            : "auto",
      headers: mergedHeaders,
      credentials,
      properties: resolvedProperties,
      agents__unsafe_dev_only: mergedAgents,
      tools: allTools,
      renderToolCalls: allRenderToolCalls,
      renderActivityMessages: renderActivityMessages,
      renderCustomMessages: renderCustomMessages,
      debug,
    });
    if (defaultThrottleMs !== undefined) {
      if (Number.isFinite(defaultThrottleMs) && defaultThrottleMs >= 0) {
        core.setDefaultThrottleMs(defaultThrottleMs);
      } else {
        console.error(
          `CopilotKitProvider: defaultThrottleMs must be a non-negative finite number, got ${defaultThrottleMs}`,
        );
      }
    }
    return core;
  };

  let copilotkit = $state(createCopilotKit());
  let executingToolCallIds = $state<ReadonlySet<string>>(new Set());
  let didMount = $state(false);

  $effect(() => {
    const core = copilotkit;
    const sub1 = core.subscribe({
      onToolExecutionStart: ({ toolCallId }) => {
        executingToolCallIds = new Set(executingToolCallIds).add(toolCallId);
      },
      onToolExecutionEnd: ({ toolCallId }) => {
        const next = new Set(executingToolCallIds);
        next.delete(toolCallId);
        setTimeout(() => {
          executingToolCallIds = next;
        }, 0);
      },
    });
    const sub2 = core.subscribe({
      onRenderToolCallsChanged: () => {},
    });
    const sub3 = core.subscribe({
      onRenderCustomMessagesChanged: () => {},
    });
    const sub4 = core.subscribe({
      onRuntimeConnectionStatusChanged: () => {},
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

  $effect(() => {
    if (!didMount) {
      didMount = true;
      return;
    }
    copilotkit.setRuntimeUrl(chatApiEndpoint);
    copilotkit.setRuntimeTransport(
      useSingleEndpoint === true
        ? "single"
        : useSingleEndpoint === false
          ? "rest"
          : "auto",
    );
    copilotkit.setHeaders(mergedHeaders);
    copilotkit.setCredentials(credentials);
    copilotkit.setProperties(resolvedProperties);
    copilotkit.setAgents__unsafe_dev_only(mergedAgents);
    copilotkit.setDebug(debug);
    if (defaultThrottleMs !== undefined) {
      copilotkit.setDefaultThrottleMs(defaultThrottleMs);
    }
  });

  $effect(() => {
    if (!didMount) return;
    copilotkit.setTools(allTools);
  });

  $effect(() => {
    if (!didMount) return;
    copilotkit.setRenderToolCalls(allRenderToolCalls);
  });

  $effect(() => {
    if (!didMount) return;
    copilotkit.setRenderCustomMessages(renderCustomMessages);
  });

  $effect(() => {
    if (!didMount) return;
    copilotkit.setRenderActivityMessages(renderActivityMessages);
  });

  setContext(COPILOT_KIT_KEY, {
    get copilotkit() {
      return copilotkit;
    },
    get executingToolCallIds() {
      return executingToolCallIds;
    },
  });
</script>

{@render children()}
