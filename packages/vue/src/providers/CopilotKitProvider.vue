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
import { CopilotKitCoreVue } from "../lib/vue-core";
import { CopilotKitKey } from "./keys";
import CopilotKitInspector from "../components/CopilotKitInspector.vue";
import type { CopilotKitProviderProps } from "./CopilotKitProvider.types";
import type {
  VueFrontendTool,
  VueHumanInTheLoop,
  VueToolCallRenderer,
} from "../types";

const HEADER_NAME = "X-CopilotCloud-Public-Api-Key";
const COPILOT_CLOUD_CHAT_URL = "https://api.cloud.copilotkit.ai/copilotkit/v1";

const FRONTEND_TOOLS_STABLE_WARNING =
  "frontendTools must be a stable array. If you want to dynamically add or remove tools, use `useFrontendTool` instead.";
const HUMAN_IN_THE_LOOP_STABLE_WARNING =
  "humanInTheLoop must be a stable array. If you want to dynamically add or remove human-in-the-loop tools, use `useHumanInTheLoop` instead.";
const RENDER_CUSTOM_MESSAGES_STABLE_WARNING =
  "renderCustomMessages must be a stable array.";

const props = withDefaults(defineProps<CopilotKitProviderProps>(), {
  headers: () => ({}),
  properties: () => ({}),
  agents__unsafe_dev_only: () => ({}),
  selfManagedAgents: () => ({}),
  frontendTools: () => [],
  humanInTheLoop: () => [],
  showDevConsole: false,
  useSingleEndpoint: false,
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
  tools.push(...processedHumanInTheLoop.value.tools);
  return tools;
});

const allRenderToolCalls = computed(() => {
  const combined: VueToolCallRenderer<unknown>[] = [];
  for (const tool of props.frontendTools) {
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
    runtimeTransport: props.useSingleEndpoint ? "single" : "rest",
    headers: mergedHeaders.value,
    credentials: props.credentials,
    properties: props.properties,
    agents__unsafe_dev_only: mergedAgents.value,
    tools: allTools.value,
    renderToolCalls: allRenderToolCalls.value,
    renderCustomMessages: allRenderCustomMessages.value,
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

function syncRuntimeConfig() {
  copilotkit.value.setRuntimeUrl(chatApiEndpoint.value);
  copilotkit.value.setRuntimeTransport(
    props.useSingleEndpoint ? "single" : "rest",
  );
  copilotkit.value.setHeaders(mergedHeaders.value);
  copilotkit.value.setCredentials(props.credentials);
  copilotkit.value.setProperties(props.properties);
  copilotkit.value.setAgents__unsafe_dev_only(mergedAgents.value);
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
  didMountRef.value = true;
});

const a2uiTheme = computed(() => props.a2ui?.theme);
provide(CopilotKitKey, { copilotkit, executingToolCallIds, a2uiTheme });
</script>

<template>
  <slot />
  <CopilotKitInspector v-if="shouldRenderInspector" :core="copilotkit" />
</template>
