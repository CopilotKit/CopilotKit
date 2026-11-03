<script setup lang="ts">
import { ɵanySchema } from "@copilotkit/shared";
import {
  computed,
  h,
  onMounted,
  onUnmounted,
  provide,
  ref,
  shallowRef,
  toRaw,
  triggerRef,
  watch,
} from "vue";
import type { Component, FunctionalComponent } from "vue";
import type { Catalog, ComponentApi } from "@a2ui/web_core/v0_9";
import {
  ɵLearningAutoStarter,
  ɵbuildHumanInTheLoopTool,
  ɵhitlRenderProps,
  ɵtoLearningConfig,
} from "@copilotkit/core";
import type {
  CopilotKitHeadersSource,
  FrontendTool,
  ɵRuntimeInfo,
} from "@copilotkit/core";
import {
  ɵSTABLE_ARRAY_WARNINGS,
  ɵbuildOpenGenerativeUIContexts,
  ɵcreateOpenGenerativeUITool,
  ɵisOpenGenerativeUIActive,
  ɵpublicKeyHeaderDefaults,
  ɵreportProviderConfigDiagnostics,
  ɵresolveLicenseState,
  ɵresolveProviderConfig,
  ɵtoolRendererShapeChanged,
  ɵwithHeaderDefaults,
} from "@copilotkit/core";
import { shouldEnableInspector } from "@copilotkit/shared";
import { CopilotKitCoreVue } from "../lib/vue-core";
import { createA2UIMessageRenderer } from "../components/A2UIMessageRenderer";
import { registerA2UIBuiltInToolCallRenderer } from "../components/a2ui/A2UIBuiltInToolCallRenderer";
import { registerA2UICatalog } from "../components/a2ui/A2UICatalogContext";
import {
  OpenGenerativeUIActivityRenderer,
  OpenGenerativeUIActivityType,
  OpenGenerativeUIContentSchema,
  OpenGenerativeUIToolRenderer,
} from "../components/OpenGenerativeUIRenderer";
import {
  MCPAppsActivityContentSchema,
  MCPAppsActivityRenderer,
  MCPAppsActivityType,
} from "../components/MCPAppsActivityRenderer";
import {
  CopilotKitKey,
  CopilotStyleOptionsKey,
  InspectorKey,
  SandboxFunctionsKey,
} from "./keys";
import type { VueInspectorOpenRequest } from "./keys";
import { MARKDOWN_RENDERER_KEY } from "./markdown-renderer";
import { LicenseContextKey } from "./license-context";
import CopilotKitInspector from "../components/CopilotKitInspector.vue";
import LicenseWarningBanner from "../components/LicenseWarningBanner.vue";
import type { CopilotKitProviderProps } from "./CopilotKitProvider.types";
import type {
  SandboxFunction,
  VueActivityMessageRenderer,
  VueFrontendTool,
  VueToolCallRenderer,
  VueToolCallRendererRenderProps,
} from "../types";

/** The MCP Apps renderer with `mcpApps.allowSameOriginFallback` applied. */
const SameOriginMCPAppsActivityRenderer: FunctionalComponent = (_, { attrs }) =>
  h(MCPAppsActivityRenderer as Component, {
    ...attrs,
    allowSameOriginFallback: true,
  });

const props = withDefaults(defineProps<CopilotKitProviderProps>(), {
  headers: () => ({}),
  properties: () => ({}),
  agents__unsafe_dev_only: () => ({}),
  selfManagedAgents: () => ({}),
  frontendTools: () => [],
  humanInTheLoop: () => [],
  renderCustomMessages: () => [],
  renderActivityMessages: () => [],
  openGenerativeUI: undefined,
  useSingleEndpoint: undefined,
  a2ui: undefined,
  mcpApps: undefined,
  enableInspector: undefined,
  nonce: undefined,
  injectStyles: true,
  // A missing boolean prop would otherwise read as `false`.
  learning: undefined,
});

provide(
  CopilotStyleOptionsKey,
  computed(() => ({ nonce: props.nonce, inject: props.injectStyles })),
);

const shouldRenderInspector = ref(false);
// Follows the Inspector's own show/hide, so message actions that open it are
// hidden while a temporary dismissal hides it.
const inspectorVisible = ref(false);

function updateInspectorVisibility(): void {
  shouldRenderInspector.value = shouldEnableInspector({
    enableInspector: props.enableInspector,
    isBrowser: true,
    isDevelopment: process.env.NODE_ENV === "development",
    hostname: window.location?.hostname,
  });
}

onMounted(updateInspectorVisibility);
watch(() => props.enableInspector, updateInspectorVisibility);

const inspectorOpenRequest = ref<VueInspectorOpenRequest | null>(null);
const isInspectorEnabled = computed(
  () => shouldRenderInspector.value && inspectorVisible.value,
);

function openInspector(request: VueInspectorOpenRequest) {
  inspectorOpenRequest.value = { ...request };
}

provide(InspectorKey, {
  isInspectorEnabled,
  openInspector,
});

const initialRenderToolCalls = props.renderToolCalls ?? [];
const initialFrontendTools = props.frontendTools;
const initialHumanInTheLoop = props.humanInTheLoop;
const initialRenderCustomMessages = props.renderCustomMessages;
const initialRenderActivityMessages = props.renderActivityMessages;
const initialSandboxFunctions = props.openGenerativeUI?.sandboxFunctions;

// Props that come from reactive state arrive as deep proxies. Zod 4 schemas
// break behind a Vue proxy (their `_zod` property is read-only and
// non-configurable), so read tools and renderers through their raw objects.
const rawEntries = <T>(entries: readonly T[] | undefined): T[] =>
  [...toRaw(entries ?? [])].map((entry) => toRaw(entry));

// Only the shape (agentId:name pairs) counts, so new render closures for the
// same tools do not warn.
watch(
  () => props.renderToolCalls,
  (next) => {
    if (ɵtoolRendererShapeChanged(initialRenderToolCalls, next ?? [])) {
      console.error(ɵSTABLE_ARRAY_WARNINGS.renderToolCalls);
    }
  },
);

watch(
  () => props.frontendTools,
  (next) => {
    if (next !== initialFrontendTools) {
      console.error(ɵSTABLE_ARRAY_WARNINGS.frontendTools);
    }
  },
);

watch(
  () => props.humanInTheLoop,
  (next) => {
    if (next !== initialHumanInTheLoop) {
      console.error(ɵSTABLE_ARRAY_WARNINGS.humanInTheLoop);
    }
  },
);

watch(
  () => props.renderCustomMessages,
  (next) => {
    if (next !== initialRenderCustomMessages) {
      console.error(ɵSTABLE_ARRAY_WARNINGS.renderCustomMessages);
    }
  },
);

watch(
  () => props.renderActivityMessages,
  (next) => {
    if (next !== initialRenderActivityMessages) {
      console.error(ɵSTABLE_ARRAY_WARNINGS.renderActivityMessages);
    }
  },
);

watch(
  () => props.openGenerativeUI?.sandboxFunctions,
  (next) => {
    if (next !== initialSandboxFunctions) {
      console.error(ɵSTABLE_ARRAY_WARNINGS.sandboxFunctions);
    }
  },
);

// Key fallback, Copilot Cloud URL, transport, agent merge and the catalog
// property all come from core.
const resolvedConfig = computed(() =>
  ɵresolveProviderConfig({
    runtimeUrl: props.runtimeUrl,
    publicApiKey: props.publicApiKey,
    publicLicenseKey: props.publicLicenseKey,
    useSingleEndpoint: props.useSingleEndpoint,
    agents__unsafe_dev_only: props.agents__unsafe_dev_only,
    selfManagedAgents: props.selfManagedAgents,
    properties: props.properties,
    a2uiCatalog: props.a2ui?.catalog,
  }),
);
// Strings, so dependents only re-run when the value really changes.
const resolvedPublicKey = computed(() => resolvedConfig.value.publicKey);
const chatApiEndpoint = computed(() => resolvedConfig.value.runtimeUrl);
const runtimeTransport = computed(() => resolvedConfig.value.runtimeTransport);
const mergedAgents = computed(() => resolvedConfig.value.agents);

// Whether `headers` is a builder, as its own computed so that a re-render
// merely passing a NEW function of the same kind (e.g. a fresh inline arrow)
// doesn't propagate: this computed's VALUE doesn't change, so Vue never marks
// `headersSource` below dirty on that account. Reading `props.headers`
// directly inside `headersSource` would defeat this — its exact identity
// would then be tracked there instead.
const isHeadersBuilder = computed(() => typeof props.headers === "function");

// Stable for the component's lifetime: reads `props.headers` fresh on every
// call, so it is always current at send time (#1937), never during render.
// The read below can return a sync record or an async promise depending on
// what `props.headers` happens to be at call time, which
// `CopilotKitHeadersSource`'s shape can't express in one function signature
// (sync-only OR async-only) — same rationale as the cast inside
// `ɵwithHeaderDefaults`.
const latestHeaders = (() =>
  typeof props.headers === "function"
    ? props.headers()
    : props.headers) as () => Record<string, string>;

// The source handed to core. A record keeps today's identity semantics (its
// own reference changes propagate); a builder is represented by the stable
// `latestHeaders` above, so only `isHeadersBuilder` and `resolvedPublicKey`
// actually drive recomputation.
const headersSource = computed<CopilotKitHeadersSource>(() =>
  ɵwithHeaderDefaults(
    isHeadersBuilder.value ? latestHeaders : props.headers,
    ɵpublicKeyHeaderDefaults(resolvedPublicKey.value),
  ),
);

// Throws in production for a missing runtime config; otherwise warns, once
// per provider for each message.
const loggedDiagnostics = new Set<string>();
watch(
  () => resolvedConfig.value.diagnostics,
  (diagnostics) => {
    ɵreportProviderConfigDiagnostics(diagnostics, {
      isProduction: process.env.NODE_ENV === "production",
      logged: loggedDiagnostics,
    });
  },
  { immediate: true },
);

const processedHumanInTheLoop = computed(() => {
  const tools: FrontendTool[] = [];
  const renderToolCalls: VueToolCallRenderer<unknown>[] = [];
  // Core parks each call by tool call id until the render responds. The core
  // is created further down, so read its registry lazily.
  const registry = () => copilotkit.value.ɵhumanInTheLoop;

  for (const tool of rawEntries(props.humanInTheLoop)) {
    const { render: ToolComponent, ...config } = tool;
    tools.push(ɵbuildHumanInTheLoopTool(config, registry) as FrontendTool);
    if (ToolComponent) {
      const render: VueToolCallRenderer<unknown>["render"] = (
        renderProps: VueToolCallRendererRenderProps<unknown>,
      ) =>
        h(
          ToolComponent as Parameters<typeof h>[0],
          ɵhitlRenderProps(renderProps, tool, registry()),
        );

      renderToolCalls.push({
        name: tool.name,
        args: tool.parameters,
        render,
        ...(tool.agentId && { agentId: tool.agentId }),
      } as VueToolCallRenderer<unknown>);
    }
  }
  return { tools, renderToolCalls };
});

const allTools = computed(() => {
  const tools: FrontendTool[] = [];
  for (const t of rawEntries(props.frontendTools)) {
    tools.push(t as FrontendTool);
  }
  for (const t of builtInFrontendTools.value) {
    tools.push(t as FrontendTool);
  }
  tools.push(...processedHumanInTheLoop.value.tools);
  return tools;
});

const allRenderToolCalls = computed(() => {
  const combined: VueToolCallRenderer<unknown>[] = [
    ...rawEntries(props.renderToolCalls),
  ];
  for (const tool of [
    ...rawEntries(props.frontendTools),
    ...builtInFrontendTools.value,
  ]) {
    if (tool.render) {
      const args =
        tool.parameters ?? (tool.name === "*" ? ɵanySchema : undefined);
      if (args) {
        combined.push({
          name: tool.name,
          args,
          render: tool.render,
        } as VueToolCallRenderer<unknown>);
      }
    }
  }
  combined.push(...processedHumanInTheLoop.value.renderToolCalls);
  return combined;
});

const allRenderCustomMessages = computed(
  () => props.renderCustomMessages ?? [],
);
// Core's runtime info snapshot, projected from the core watcher below.
const runtimeInfo = shallowRef<ɵRuntimeInfo | null>(null);
const runtimeA2UIEnabled = computed(
  () => runtimeInfo.value?.a2uiEnabled ?? false,
);
const runtimeOpenGenerativeUIEnabled = computed(
  () => runtimeInfo.value?.openGenerativeUIEnabled ?? false,
);
const runtimeLicenseStatus = computed(() => runtimeInfo.value?.licenseStatus);
const runtimeEntitlements = computed(
  () => runtimeInfo.value?.runtimeEntitlements,
);
const runtimeEntitlementRetryPending = computed(
  () => runtimeInfo.value?.runtimeEntitlementRetryPending ?? false,
);
const openGenerativeUIActive = computed(() =>
  ɵisOpenGenerativeUIActive({
    runtimeEnabled: runtimeOpenGenerativeUIEnabled.value,
    configured: !!props.openGenerativeUI,
  }),
);
// A catalog passed to the provider is enough to turn A2UI on: render the
// surfaces locally and forward the catalog signal so the runtime injects the
// render tool — no runtime-side `a2ui` config required.
const a2uiCatalogProvided = computed(() => !!props.a2ui?.catalog);
const a2uiActive = computed(
  () => runtimeA2UIEnabled.value || a2uiCatalogProvided.value,
);
// The catalog with components disabled in the Inspector removed; set by
// `registerA2UICatalog` below once the core exists.
const a2uiFilteredCatalog = shallowRef<Catalog<ComponentApi> | undefined>(
  undefined,
);
// Forward a per-run signal when the provider has an A2UI catalog so the
// runtime can turn A2UI on (and inject the render tool) without a separate
// `a2ui.injectA2UITool` flag on the runtime.
const resolvedProperties = computed(() => resolvedConfig.value.properties);
const sandboxFunctions = computed<readonly SandboxFunction[]>(() =>
  rawEntries(props.openGenerativeUI?.sandboxFunctions),
);
const builtInFrontendTools = computed<VueFrontendTool[]>(() => {
  if (!openGenerativeUIActive.value) return [];
  return [
    {
      ...ɵcreateOpenGenerativeUITool(),
      render:
        OpenGenerativeUIToolRenderer as unknown as VueFrontendTool["render"],
    } as VueFrontendTool,
  ];
});

const builtInActivityRenderers = computed<
  VueActivityMessageRenderer<unknown>[]
>(() => {
  const renderers: VueActivityMessageRenderer<unknown>[] = [
    {
      activityType: MCPAppsActivityType,
      content: MCPAppsActivityContentSchema,
      render: (props.mcpApps?.allowSameOriginFallback
        ? SameOriginMCPAppsActivityRenderer
        : MCPAppsActivityRenderer) as unknown as VueActivityMessageRenderer<unknown>["render"],
    },
  ];

  if (openGenerativeUIActive.value) {
    renderers.push({
      activityType: OpenGenerativeUIActivityType,
      content: OpenGenerativeUIContentSchema,
      render:
        OpenGenerativeUIActivityRenderer as unknown as VueActivityMessageRenderer<unknown>["render"],
    });
  }

  if (a2uiActive.value) {
    renderers.unshift(
      createA2UIMessageRenderer({
        theme: props.a2ui?.theme ?? {},
        catalog: a2uiFilteredCatalog.value ?? props.a2ui?.catalog,
        loadingComponent: props.a2ui?.loadingComponent,
        recovery: props.a2ui?.recovery,
        onAction: props.a2ui?.onAction,
      }),
    );
  }

  return renderers;
});

const allRenderActivityMessages = computed(() => [
  ...rawEntries(props.renderActivityMessages),
  ...builtInActivityRenderers.value,
]);

const learningConfig = computed(() => ɵtoLearningConfig(props.learning));

const createCopilotKit = () =>
  new CopilotKitCoreVue({
    runtimeUrl: chatApiEndpoint.value,
    // `/info` starts from `onMounted` (`connect()` below), so server-side
    // setup never fetches it.
    deferInitialConnection: true,
    runtimeTransport: runtimeTransport.value,
    headers: headersSource.value,
    credentials: props.credentials,
    messageFilter: props.messageFilter,
    properties: resolvedProperties.value,
    agents__unsafe_dev_only: mergedAgents.value,
    tools: allTools.value,
    renderToolCalls: allRenderToolCalls.value,
    renderActivityMessages: allRenderActivityMessages.value,
    renderCustomMessages: allRenderCustomMessages.value,
    debug: props.debug,
    // Set at construction so child hooks can read it on first render. Core
    // validates it.
    defaultThrottleMs: props.defaultThrottleMs,
    onError: props.onError,
    learning: learningConfig.value,
  });

const copilotkit = shallowRef<CopilotKitCoreVue>(createCopilotKit());
const didMountRef = ref(false);

const executingToolCallIds = ref<ReadonlySet<string>>(new Set());

watch(
  copilotkit,
  (core, _, onCleanup) => {
    // Core keeps a call executing until its result is in the messages, so
    // the status never drops back to in-progress between the two.
    executingToolCallIds.value = core.executingToolCallIds;
    const sub1 = core.subscribe({
      onExecutingToolCallsChanged: ({ executingToolCallIds: ids }) => {
        const hasFinishedCall = ids.size < executingToolCallIds.value.size;
        executingToolCallIds.value = ids;
        // Core adds the result to `agent.messages` without a messages event,
        // so re-read the agents once a call finishes. Not on start: that
        // re-runs the agent subscriptions mid-run and drops a pending update.
        if (hasFinishedCall) triggerRef(copilotkit);
      },
    });
    const sub2 = core.subscribe({
      onRenderToolCallsChanged: () => {
        triggerRef(copilotkit);
      },
    });
    const sub3 = core.subscribe({
      onRenderCustomMessagesChanged: () => {
        triggerRef(copilotkit);
      },
      onRenderActivityMessagesChanged: () => {
        triggerRef(copilotkit);
      },
    });
    runtimeInfo.value = core.ɵruntimeInfo;
    const unsubscribeRuntimeInfo = core.ɵsubscribeToRuntimeInfo(() => {
      runtimeInfo.value = core.ɵruntimeInfo;
    });
    // Consumers read runtime getters off `copilotkit` directly, so every
    // status event invalidates them.
    const sub4 = core.subscribe({
      onRuntimeConnectionStatusChanged: () => {
        triggerRef(copilotkit);
      },
    });
    // `onHeadersChanged` fires only from a real `setHeaders()` call (a new
    // source), never from a builder resolving a new token — same generation
    // core bumps. Without this, nothing pokes Vue's reactivity when a source
    // change lands: `ɵheadersGeneration` is a plain property read, not a
    // ref/reactive value, so `headersKey` (use-threads.ts) and the
    // HttpAgent watcher (use-agent.ts) only re-read it when SOME OTHER
    // trigger happens to fire around the same time (#1937).
    const sub6 = core.subscribe({
      onHeadersChanged: () => {
        triggerRef(copilotkit);
      },
    });
    onCleanup(() => {
      sub1.unsubscribe();
      sub2.unsubscribe();
      sub3.unsubscribe();
      sub4.unsubscribe();
      unsubscribeRuntimeInfo();
      sub6.unsubscribe();
    });
  },
  { immediate: true },
);

watch([allTools], ([tools]) => {
  if (!didMountRef.value) return;
  copilotkit.value.setTools(tools);
});

watch([allRenderToolCalls], ([renderToolCalls]) => {
  if (!didMountRef.value) return;
  copilotkit.value.setRenderToolCalls(renderToolCalls);
});

watch([allRenderCustomMessages], ([renderCustomMessages]) => {
  if (!didMountRef.value) return;
  copilotkit.value.setRenderCustomMessages(renderCustomMessages);
});

watch([allRenderActivityMessages], ([renderActivityMessages]) => {
  if (!didMountRef.value) return;
  copilotkit.value.setRenderActivityMessages(renderActivityMessages);
});

// Every setter is a no-op when its value did not change (`setHeaders` too, for
// the same builder or an equal record, see #1937), so this can pass every key.
function syncRuntimeConfig() {
  copilotkit.value.ɵupdateConfig({
    messageFilter: props.messageFilter,
    runtimeUrl: chatApiEndpoint.value,
    runtimeTransport: runtimeTransport.value,
    headers: headersSource.value,
    credentials: props.credentials,
    properties: resolvedProperties.value,
    agents__unsafe_dev_only: mergedAgents.value,
    debug: props.debug,
    defaultThrottleMs: props.defaultThrottleMs,
  });
}

watch(
  () => props.onError,
  (onError) => copilotkit.value.setErrorHandler(onError),
);

watch(
  [
    () => chatApiEndpoint.value,
    () => headersSource.value,
    () => props.credentials,
    () => props.messageFilter,
    () => resolvedProperties.value,
    () => mergedAgents.value,
    () => runtimeTransport.value,
    () => props.debug,
  ],
  () => {
    if (!didMountRef.value) return;
    syncRuntimeConfig();
  },
);

watch(
  () => props.defaultThrottleMs,
  (defaultThrottleMs) => {
    if (!didMountRef.value) return;
    copilotkit.value.ɵupdateConfig({ defaultThrottleMs });
    triggerRef(copilotkit);
  },
);

onMounted(() => {
  syncRuntimeConfig();
  // The constructor deferred `/info`; start it now that we are in the browser
  // (`onMounted` never runs during SSR). Idempotent.
  copilotkit.value.connect();
  runtimeInfo.value = copilotkit.value.ɵruntimeInfo;
  didMountRef.value = true;
  // After the runtime URL is set, so CopilotKit's own runtime traffic is never
  // captured. The provider's onUnmounted disposes the starter (stops capture).
  watch(
    () => props.learning,
    (learning) => learningStarter.update(learning),
    {
      immediate: true,
    },
  );
});

const learningStarter = new ɵLearningAutoStarter(copilotkit.value);

const a2uiTheme = computed(() => props.a2ui?.theme);
const a2uiCatalog = computed(() => props.a2ui?.catalog);
const a2uiLoadingComponent = computed(() => props.a2ui?.loadingComponent);
const a2uiIncludeSchema = computed(() => props.a2ui?.includeSchema ?? true);

// A2UI tool call renderer (progress indicator) — auto-registered when A2UI enabled
registerA2UIBuiltInToolCallRenderer(copilotkit, () => a2uiActive.value);

// A2UI catalog: component registration for the Inspector, the filtered
// catalog, and the agent context (schema, generation/design guidelines).
registerA2UICatalog(copilotkit, {
  enabled: () => a2uiActive.value,
  catalog: () => props.a2ui?.catalog,
  includeSchema: () => props.a2ui?.includeSchema ?? true,
  onFilteredCatalog: (catalog) => {
    a2uiFilteredCatalog.value = catalog;
  },
});

const providerContextIds = ref<string[]>([]);
watch(
  [
    openGenerativeUIActive,
    sandboxFunctions,
    () => props.openGenerativeUI?.designSkill,
  ],
  ([active, functions, designSkill], _previous, onCleanup) => {
    if (!active) return;

    const ids = ɵbuildOpenGenerativeUIContexts({
      designSkill,
      sandboxFunctions: functions,
    }).map((entry) => copilotkit.value.addContext(entry));

    providerContextIds.value = ids;
    onCleanup(() => {
      for (const id of ids) {
        copilotkit.value.removeContext(id);
      }
    });
  },
  { immediate: true },
);

provide(CopilotKitKey, {
  copilotkit,
  executingToolCallIds,
  a2uiTheme,
  a2uiCatalog,
  a2uiLoadingComponent,
  a2uiIncludeSchema,
});
provide(SandboxFunctionsKey, sandboxFunctions);
provide(MARKDOWN_RENDERER_KEY, props.markdownRenderer);

// License context and banner, from the runtime license status and the
// structured entitlement response.
const licenseState = computed(() =>
  ɵresolveLicenseState({
    status: runtimeLicenseStatus.value,
    entitlements: runtimeEntitlements.value,
    retryPending: runtimeEntitlementRetryPending.value,
    publicKey: resolvedPublicKey.value,
  }),
);
const licenseContextValue = computed(() => licenseState.value.context);
provide(LicenseContextKey, licenseContextValue);
const licenseBannerType = computed(() => licenseState.value.bannerType);

// The provider created this core, so it stops the core's runs, timers and
// subscriptions. `onUnmounted` runs after the children unmount, so their
// cleanup still reaches a live core.
onUnmounted(() => {
  learningStarter.dispose();
  copilotkit.value.dispose();
});
</script>

<template>
  <slot />
  <CopilotKitInspector
    v-if="shouldRenderInspector"
    :core="copilotkit"
    :open-request="inspectorOpenRequest"
    @visibility-change="inspectorVisible = $event"
  />
  <!-- License warnings — driven by server-reported status -->
  <LicenseWarningBanner v-if="licenseBannerType" :type="licenseBannerType" />
</template>
