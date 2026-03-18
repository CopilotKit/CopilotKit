<script setup lang="ts">
import { computed, provide, ref, shallowRef, triggerRef, watch } from "vue";
import { z } from "zod";
import type { AbstractAgent } from "@ag-ui/client";
import { FrontendTool } from "@copilotkitnext/core";
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

const props = withDefaults(
  defineProps<CopilotKitProviderProps>(),
  {
    headers: () => ({}),
    properties: () => ({}),
    agents__unsafe_dev_only: () => ({}),
    selfManagedAgents: () => ({}),
    frontendTools: () => [],
    humanInTheLoop: () => [],
    showDevConsole: false,
    useSingleEndpoint: false,
    a2ui: undefined,
  },
);

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

watch(() => props.showDevConsole, updateInspectorVisibility, { immediate: true });

const initialFrontendTools = props.frontendTools;
const initialHumanInTheLoop = props.humanInTheLoop;

watch(() => props.frontendTools, (next) => {
  if (next !== initialFrontendTools) {
    console.error(FRONTEND_TOOLS_STABLE_WARNING);
  }
});

watch(() => props.humanInTheLoop, (next) => {
  if (next !== initialHumanInTheLoop) {
    console.error(HUMAN_IN_THE_LOOP_STABLE_WARNING);
  }
});

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

const mergedHeaders = computed(() => {
  if (!resolvedPublicKey.value) return props.headers;
  if (props.headers[HEADER_NAME]) return props.headers;
  return { ...props.headers, [HEADER_NAME]: resolvedPublicKey.value };
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

const createCopilotKit = () =>
  new CopilotKitCoreVue({
    runtimeUrl: chatApiEndpoint.value,
    runtimeTransport: props.useSingleEndpoint ? "single" : "rest",
    headers: mergedHeaders.value,
    credentials: props.credentials,
    properties: props.properties,
    agents__unsafe_dev_only: mergedAgents.value,
    tools: allTools.value,
    renderToolCalls: allRenderToolCalls.value,
  });

const copilotkit = shallowRef<CopilotKitCoreVue>(createCopilotKit());

const executingToolCallIds = ref<ReadonlySet<string>>(new Set());

watch(
  [
    allTools,
    allRenderToolCalls,
    () => props.useSingleEndpoint,
  ],
  () => {
    copilotkit.value = createCopilotKit();
    executingToolCallIds.value = new Set();
  },
);

watch(
  copilotkit,
  (core, _, onCleanup) => {
    const sub1 = core.subscribe({
      onToolExecutionStart: ({ toolCallId }) => {
        executingToolCallIds.value = new Set(executingToolCallIds.value).add(
          toolCallId,
        );
      },
      onToolExecutionEnd: ({ toolCallId }) => {
        const next = new Set(executingToolCallIds.value);
        next.delete(toolCallId);
        executingToolCallIds.value = next;
      },
    });
    const sub2 = core.subscribe({
      onRenderToolCallsChanged: () => {
        triggerRef(copilotkit);
      },
    });
    const sub3 = core.subscribe({
      onRuntimeConnectionStatusChanged: () => {
        triggerRef(copilotkit);
      },
    });
    const sub4 = core.subscribe({
      onError: (event) => {
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
    });
  },
  { immediate: true },
);

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
    copilotkit.value.setRuntimeUrl(chatApiEndpoint.value);
    copilotkit.value.setRuntimeTransport(
      props.useSingleEndpoint ? "single" : "rest",
    );
    copilotkit.value.setHeaders(mergedHeaders.value);
    copilotkit.value.setCredentials(props.credentials);
    copilotkit.value.setProperties(props.properties);
    copilotkit.value.setAgents__unsafe_dev_only(mergedAgents.value);
  },
);

const a2uiTheme = computed(() => props.a2ui?.theme);
provide(CopilotKitKey, { copilotkit, executingToolCallIds, a2uiTheme });
</script>

<template>
  <slot />
  <CopilotKitInspector
    v-if="shouldRenderInspector"
    :core="copilotkit"
  />
</template>
