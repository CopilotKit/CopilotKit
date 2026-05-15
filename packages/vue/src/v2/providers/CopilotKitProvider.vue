<script setup lang="ts">
import {
  computed,
  onMounted,
  provide,
  ref,
  shallowRef,
  triggerRef,
  watch,
} from "vue";
import { z } from "zod";
import type { AbstractAgent } from "@ag-ui/client";
import type {
  CopilotKitCoreErrorCode,
  CopilotKitCoreSubscriber,
  FrontendTool,
} from "@copilotkit/core";
import { schemaToJsonSchema } from "@copilotkit/shared";
import { zodToJsonSchema } from "zod-to-json-schema";
import { CopilotKitCoreVue } from "../lib/vue-core";
import { createA2UIMessageRenderer } from "../components/A2UIMessageRenderer";
import { registerA2UIBuiltInToolCallRenderer } from "../components/a2ui/A2UIBuiltInToolCallRenderer";
import { registerA2UICatalogContext } from "../components/a2ui/A2UICatalogContext";
import {
  GenerateSandboxedUiArgsSchema,
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
import { CopilotKitKey, SandboxFunctionsKey } from "./keys";
import {
  LicenseContextKey,
  createLicenseContextValue,
  type LicenseContextValue,
} from "./license-context";
import CopilotKitInspector from "../components/CopilotKitInspector.vue";
import LicenseWarningBanner from "../components/LicenseWarningBanner.vue";
import type { CopilotKitProviderProps } from "./CopilotKitProvider.types";
import type {
  SandboxFunction,
  VueActivityMessageRenderer,
  VueFrontendTool,
  VueHumanInTheLoop,
  VueToolCallRenderer,
} from "../types";

const HEADER_NAME = "X-CopilotCloud-Public-Api-Key";
const COPILOT_CLOUD_CHAT_URL = "https://api.cloud.copilotkit.ai/copilotkit/v1";

// Canonical A2UI viewer theme default (matches @copilotkit/a2ui-renderer).
// Defined locally to avoid pulling React dependencies from a2ui-renderer.
const viewerTheme: Record<string, unknown> = {};

const FRONTEND_TOOLS_STABLE_WARNING =
  "frontendTools must be a stable array. If you want to dynamically add or remove tools, use `useFrontendTool` instead.";
const HUMAN_IN_THE_LOOP_STABLE_WARNING =
  "humanInTheLoop must be a stable array. If you want to dynamically add or remove human-in-the-loop tools, use `useHumanInTheLoop` instead.";
const RENDER_CUSTOM_MESSAGES_STABLE_WARNING =
  "renderCustomMessages must be a stable array.";
const RENDER_ACTIVITY_MESSAGES_STABLE_WARNING =
  "renderActivityMessages must be a stable array.";
const SANDBOX_FUNCTIONS_STABLE_WARNING =
  "openGenerativeUI.sandboxFunctions must be a stable array.";
const DEFAULT_DESIGN_SKILL = `When generating UI with generateSandboxedUi, follow these design principles inspired by shadcn/ui:

- Use a minimal, flat aesthetic. Avoid drop shadows and gradients — rely on subtle borders (1px solid, light gray like #e5e7eb) to define surfaces.
- Neutral base palette: white backgrounds, zinc/slate gray text (#09090b for headings, #71717a for secondary text). One accent color for interactive elements.
- Use system font stacks (system-ui, -apple-system, sans-serif) at readable sizes (14px body, 600 weight for headings). Tight line-heights.
- Small, consistent border-radius (6–8px). Cards and containers use border, not shadow, for separation.
- Buttons: solid fill for primary (dark bg, white text), outline for secondary (border + transparent bg). Subtle hover state (slight opacity or background shift).
- Use CSS Grid or Flexbox for layout. Ensure the UI looks good at any width.
- Minimal transitions (150ms) for hover/focus states only. No decorative animations.
- Keep the UI focused and dense — avoid excessive padding. Use compact spacing (8–12px gaps, 10–14px padding in controls).`;

const GENERATE_SANDBOXED_UI_DESCRIPTION =
  "Generate sandboxed UI. " +
  "IMPORTANT: The generated code runs in a sandboxed iframe WITHOUT same-origin access. " +
  "Do NOT use localStorage, sessionStorage, document.cookie, IndexedDB, or fetch/XMLHttpRequest to same-origin URLs. " +
  "To communicate with the host application, use Websandbox.connection.remote.<functionName>(args) which returns a Promise.\n\n" +
  "You CAN use external libraries from CDNs by including <script> or <link> tags in the HTML <head> (e.g., Chart.js, D3, Three.js, x-data-spreadsheet, etc.). " +
  "CDN resources load normally inside the sandbox.\n\n" +
  "PARAMETER ORDER IS CRITICAL — generate parameters in exactly this order:\n" +
  "1. initialHeight + placeholderMessages (shown to user while generating)\n" +
  "2. css (all styles FIRST — the user sees a placeholder until CSS is complete)\n" +
  "3. html (streams in live — the user watches the UI build as HTML is generated)\n" +
  "4. jsFunctions (reusable helper functions)\n" +
  "5. jsExpressions (applied one-by-one — the user sees each expression take effect)";

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
  showDevConsole: false,
  useSingleEndpoint: undefined,
  a2ui: undefined,
});

const shouldRenderInspector = ref(false);

const updateInspectorVisibility = () => {
  if (props.showDevConsole === true) {
    shouldRenderInspector.value = true;
    return;
  }
  if (props.showDevConsole === "auto") {
    if (typeof window === "undefined") {
      shouldRenderInspector.value = false;
      return;
    }
    const localhostHosts = new Set(["localhost", "127.0.0.1"]);
    shouldRenderInspector.value = localhostHosts.has(window.location.hostname);
    return;
  }
  shouldRenderInspector.value = false;
};

watch(() => props.showDevConsole, updateInspectorVisibility, {
  immediate: true,
});

const initialFrontendTools = props.frontendTools;
const initialHumanInTheLoop = props.humanInTheLoop;
const initialRenderCustomMessages = props.renderCustomMessages;
const initialRenderActivityMessages = props.renderActivityMessages;
const initialSandboxFunctions = props.openGenerativeUI?.sandboxFunctions;

watch(
  () => props.frontendTools,
  (next) => {
    if (next !== initialFrontendTools) {
      console.error(FRONTEND_TOOLS_STABLE_WARNING);
    }
  },
);

watch(
  () => props.humanInTheLoop,
  (next) => {
    if (next !== initialHumanInTheLoop) {
      console.error(HUMAN_IN_THE_LOOP_STABLE_WARNING);
    }
  },
);

watch(
  () => props.renderCustomMessages,
  (next) => {
    if (next !== initialRenderCustomMessages) {
      console.error(RENDER_CUSTOM_MESSAGES_STABLE_WARNING);
    }
  },
);

watch(
  () => props.renderActivityMessages,
  (next) => {
    if (next !== initialRenderActivityMessages) {
      console.error(RENDER_ACTIVITY_MESSAGES_STABLE_WARNING);
    }
  },
);

watch(
  () => props.openGenerativeUI?.sandboxFunctions,
  (next) => {
    if (next !== initialSandboxFunctions) {
      console.error(SANDBOX_FUNCTIONS_STABLE_WARNING);
    }
  },
);

const resolvedPublicKey = computed(
  () => props.publicApiKey ?? props.publicLicenseKey,
);
const mergedAgents = computed(() => ({
  ...props.agents__unsafe_dev_only,
  ...props.selfManagedAgents,
}));
const hasLocalAgents = computed(
  () => Object.keys(mergedAgents.value).length > 0,
);

const resolvedHeaders = computed(() =>
  typeof props.headers === "function" ? props.headers() : props.headers,
);

const mergedHeaders = computed(() => {
  const headers = resolvedHeaders.value;
  if (!resolvedPublicKey.value) return headers;
  if (headers[HEADER_NAME]) return headers;
  return { ...headers, [HEADER_NAME]: resolvedPublicKey.value };
});

const chatApiEndpoint = computed(
  () =>
    props.runtimeUrl ??
    (resolvedPublicKey.value ? COPILOT_CLOUD_CHAT_URL : undefined),
);

watch(
  [chatApiEndpoint, resolvedPublicKey, hasLocalAgents],
  ([endpoint, publicKey, localAgents]) => {
    if (endpoint || publicKey || localAgents) return;
    const msg =
      "Missing required prop: 'runtimeUrl' or 'publicApiKey' or 'publicLicenseKey'";
    if (process.env.NODE_ENV === "production") {
      throw new Error(msg);
    }
    console.warn(msg);
  },
  { immediate: true },
);

const processedHumanInTheLoop = computed(() => {
  const tools: FrontendTool[] = [];
  const renderToolCalls: VueToolCallRenderer<unknown>[] = [];

  for (const tool of props.humanInTheLoop) {
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
      renderToolCalls.push({
        name: tool.name,
        args: tool.parameters ?? z.any(),
        render: tool.render,
        ...(tool.agentId && { agentId: tool.agentId }),
      } as VueToolCallRenderer<unknown>);
    }
  }
  return { tools, renderToolCalls };
});

const allTools = computed(() => {
  const tools: FrontendTool[] = [];
  for (const t of props.frontendTools) {
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
    ...(props.renderToolCalls ?? []),
  ];
  for (const tool of [...props.frontendTools, ...builtInFrontendTools.value]) {
    if (tool.render) {
      const args = tool.parameters ?? (tool.name === "*" ? z.any() : undefined);
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
const runtimeA2UIEnabled = ref(false);
const runtimeOpenGenerativeUIEnabled = ref(false);
const runtimeLicenseStatus = ref<string | undefined>(undefined);
const openGenerativeUIActive = computed(
  () => runtimeOpenGenerativeUIEnabled.value || !!props.openGenerativeUI,
);
const sandboxFunctions = computed<readonly SandboxFunction[]>(
  () => props.openGenerativeUI?.sandboxFunctions ?? [],
);
const zodToJsonSchemaCompat = (
  schema: unknown,
  options?: { $refStrategy?: string },
): Record<string, unknown> =>
  zodToJsonSchema(
    schema as z.ZodTypeAny,
    options as { $refStrategy?: "none" | "relative" | "root" | "seen" },
  ) as Record<string, unknown>;

const builtInFrontendTools = computed<VueFrontendTool[]>(() => {
  if (!openGenerativeUIActive.value) return [];
  return [
    {
      name: "generateSandboxedUi",
      description: GENERATE_SANDBOXED_UI_DESCRIPTION,
      parameters: GenerateSandboxedUiArgsSchema,
      handler: async () => "UI generated",
      followUp: true,
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
      content: MCPAppsActivityContentSchema as unknown as z.ZodSchema<unknown>,
      render:
        MCPAppsActivityRenderer as unknown as VueActivityMessageRenderer<unknown>["render"],
    },
  ];

  if (openGenerativeUIActive.value) {
    renderers.push({
      activityType: OpenGenerativeUIActivityType,
      content: OpenGenerativeUIContentSchema as unknown as z.ZodSchema<unknown>,
      render:
        OpenGenerativeUIActivityRenderer as unknown as VueActivityMessageRenderer<unknown>["render"],
    });
  }

  if (runtimeA2UIEnabled.value) {
    renderers.unshift(
      createA2UIMessageRenderer({
        theme: props.a2ui?.theme ?? viewerTheme,
        catalog: props.a2ui?.catalog,
        loadingComponent: props.a2ui?.loadingComponent,
      }),
    );
  }

  return renderers;
});

const allRenderActivityMessages = computed(() => [
  ...(props.renderActivityMessages ?? []),
  ...builtInActivityRenderers.value,
]);

const applyDefaultThrottleMs = (core: CopilotKitCoreVue) => {
  if (
    props.defaultThrottleMs !== undefined &&
    (!Number.isFinite(props.defaultThrottleMs) || props.defaultThrottleMs < 0)
  ) {
    console.error(
      `CopilotKitProvider: defaultThrottleMs must be a non-negative finite number, got ${props.defaultThrottleMs}. useAgent hooks without an explicit throttleMs will fall back to unthrottled.`,
    );
  }
  core.setDefaultThrottleMs(props.defaultThrottleMs);
};

const createCopilotKit = () => {
  const core = new CopilotKitCoreVue({
    runtimeUrl: chatApiEndpoint.value,
    runtimeTransport:
      props.useSingleEndpoint === true
        ? "single"
        : props.useSingleEndpoint === false
          ? "rest"
          : "auto",
    headers: mergedHeaders.value,
    credentials: props.credentials,
    properties: props.properties,
    agents__unsafe_dev_only: mergedAgents.value,
    tools: allTools.value,
    renderToolCalls: allRenderToolCalls.value,
    renderActivityMessages: allRenderActivityMessages.value,
    renderCustomMessages: allRenderCustomMessages.value,
    debug: props.debug,
  });
  // Initialize synchronously so child hooks can read the value on first render.
  applyDefaultThrottleMs(core);
  return core;
};

const copilotkit = shallowRef<CopilotKitCoreVue>(createCopilotKit());
const didMountRef = ref(false);

const executingToolCallIds = ref<ReadonlySet<string>>(new Set());

watch(
  copilotkit,
  (core, _, onCleanup) => {
    const sub1 = core.subscribe({
      onToolExecutionStart: ({
        toolCallId,
      }: Parameters<
        NonNullable<CopilotKitCoreSubscriber["onToolExecutionStart"]>
      >[0]) => {
        executingToolCallIds.value = new Set(executingToolCallIds.value).add(
          toolCallId,
        );
      },
      onToolExecutionEnd: ({
        toolCallId,
      }: Parameters<
        NonNullable<CopilotKitCoreSubscriber["onToolExecutionEnd"]>
      >[0]) => {
        setTimeout(() => {
          const next = new Set(executingToolCallIds.value);
          next.delete(toolCallId);
          executingToolCallIds.value = next;
          triggerRef(copilotkit);
        }, 0);
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
    });
    const sub4 = core.subscribe({
      onRuntimeConnectionStatusChanged: () => {
        runtimeA2UIEnabled.value = core.a2uiEnabled;
        runtimeOpenGenerativeUIEnabled.value = core.openGenerativeUIEnabled;
        runtimeLicenseStatus.value = core.licenseStatus;
        triggerRef(copilotkit);
      },
    });
    const sub5 = core.subscribe({
      onError: (event: {
        error: Error;
        code: CopilotKitCoreErrorCode;
        context: Record<string, any>;
      }) => {
        void props.onError?.({
          error: event.error,
          code: event.code,
          context: event.context,
        });
      },
    });
    onCleanup(() => {
      sub1.unsubscribe();
      sub2.unsubscribe();
      sub3.unsubscribe();
      sub4.unsubscribe();
      sub5.unsubscribe();
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
  triggerRef(copilotkit);
});

watch([allRenderActivityMessages], ([renderActivityMessages]) => {
  if (!didMountRef.value) return;
  copilotkit.value.setRenderActivityMessages(renderActivityMessages);
  triggerRef(copilotkit);
});

function syncRuntimeConfig() {
  copilotkit.value.setRuntimeUrl(chatApiEndpoint.value);
  copilotkit.value.setRuntimeTransport(
    props.useSingleEndpoint === true
      ? "single"
      : props.useSingleEndpoint === false
        ? "rest"
        : "auto",
  );
  copilotkit.value.setHeaders(mergedHeaders.value);
  copilotkit.value.setCredentials(props.credentials);
  copilotkit.value.setProperties(props.properties);
  copilotkit.value.setAgents__unsafe_dev_only(mergedAgents.value);
  copilotkit.value.setDebug(props.debug);
  applyDefaultThrottleMs(copilotkit.value);
}

watch(
  [
    () => chatApiEndpoint.value,
    () => mergedHeaders.value,
    () => props.credentials,
    () => props.properties,
    () => mergedAgents.value,
    () => props.useSingleEndpoint,
    () => props.debug,
  ],
  () => {
    if (!didMountRef.value) return;
    syncRuntimeConfig();
  },
);

watch(
  () => props.defaultThrottleMs,
  () => {
    if (!didMountRef.value) return;
    applyDefaultThrottleMs(copilotkit.value);
    triggerRef(copilotkit);
  },
);

onMounted(() => {
  syncRuntimeConfig();
  runtimeA2UIEnabled.value = copilotkit.value.a2uiEnabled;
  runtimeOpenGenerativeUIEnabled.value =
    copilotkit.value.openGenerativeUIEnabled;
  runtimeLicenseStatus.value = copilotkit.value.licenseStatus;
  didMountRef.value = true;
});

const a2uiTheme = computed(() => props.a2ui?.theme);
const a2uiCatalog = computed(() => props.a2ui?.catalog);
const a2uiLoadingComponent = computed(() => props.a2ui?.loadingComponent);
const a2uiIncludeSchema = computed(() => props.a2ui?.includeSchema ?? true);

// A2UI tool call renderer (progress indicator) — auto-registered when A2UI enabled
registerA2UIBuiltInToolCallRenderer(copilotkit, () => runtimeA2UIEnabled.value);

// A2UI catalog context, schema, and generation/design guidelines
registerA2UICatalogContext(copilotkit, {
  enabled: () => runtimeA2UIEnabled.value,
  catalog: () => props.a2ui?.catalog,
  includeSchema: () => props.a2ui?.includeSchema ?? true,
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

    const ids: string[] = [];
    ids.push(
      copilotkit.value.addContext({
        description:
          "Design guidelines for the generateSandboxedUi tool. Follow these when building UI.",
        value: designSkill ?? DEFAULT_DESIGN_SKILL,
      }),
    );

    if (functions.length > 0) {
      const descriptors = JSON.stringify(
        functions.map((fn) => ({
          name: fn.name,
          description: fn.description,
          parameters: schemaToJsonSchema(fn.parameters, {
            zodToJsonSchema: zodToJsonSchemaCompat,
          }),
        })),
      );
      ids.push(
        copilotkit.value.addContext({
          description:
            "Sandbox functions available in generated sandboxed UI code. Call via Websandbox.connection.remote.<functionName>(args).",
          value: descriptors,
        }),
      );
    }

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

// License context — driven by server-reported `/info` license status.
// Stays at the permissive default (`createLicenseContextValue(null)`)
// to mirror React's current provider behavior; banner rendering below
// is the sole consumer of `runtimeLicenseStatus`.
const licenseContextValue = computed<LicenseContextValue>(() =>
  createLicenseContextValue(null),
);
provide(LicenseContextKey, licenseContextValue);

const showNoLicenseBanner = computed(
  () => runtimeLicenseStatus.value === "none" && !resolvedPublicKey.value,
);
const showExpiredBanner = computed(
  () => runtimeLicenseStatus.value === "expired",
);
const showInvalidBanner = computed(
  () => runtimeLicenseStatus.value === "invalid",
);
const showExpiringBanner = computed(
  () => runtimeLicenseStatus.value === "expiring",
);
</script>

<template>
  <slot />
  <CopilotKitInspector
    v-if="shouldRenderInspector"
    :core="copilotkit"
    :default-anchor="props.inspectorDefaultAnchor"
  />
  <!-- License warnings — driven by server-reported status -->
  <LicenseWarningBanner v-if="showNoLicenseBanner" type="no_license" />
  <LicenseWarningBanner v-if="showExpiredBanner" type="expired" />
  <LicenseWarningBanner v-if="showInvalidBanner" type="invalid" />
  <LicenseWarningBanner v-if="showExpiringBanner" type="expiring" />
</template>
