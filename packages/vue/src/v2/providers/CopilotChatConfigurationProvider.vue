<script setup lang="ts">
import { computed, inject, provide, ref } from "vue";
import type { ComputedRef } from "vue";
import { DEFAULT_AGENT_ID, randomUUID } from "@copilotkit/shared";
import { CopilotChatConfigurationKey } from "./keys";
import { CopilotChatDefaultLabels } from "./types";
import type { CopilotChatConfigurationValue, CopilotChatLabels } from "./types";
import type { CopilotChatConfigurationProviderProps } from "./CopilotChatConfigurationProvider.types";
import { useShallowStableRef } from "../lib/shallow-stable";

// Vue normalizes optional Boolean props to `false` when not supplied; declare
// `undefined` defaults so we can faithfully distinguish "caller passed false"
// from "caller did not pass the prop", matching React's prop semantics.
const props = withDefaults(
  defineProps<CopilotChatConfigurationProviderProps>(),
  {
    hasExplicitThreadId: undefined,
    isModalDefaultOpen: undefined,
  },
);

const parentConfig = inject<ComputedRef<CopilotChatConfigurationValue> | null>(
  CopilotChatConfigurationKey,
  null,
);
const parentConfigValue = computed(() => parentConfig?.value ?? null);

// Caller-authoritative when a threadId prop is supplied AND not explicitly
// flagged non-explicit. A <CopilotKit>-seeded non-explicit id
// (threadId + hasExplicitThreadId=false) stays overridable — the round-2 fix.
const propIsAuthoritative = computed(
  () => props.threadId !== undefined && props.hasExplicitThreadId !== false,
);

// Imperative active-thread override (a picked row or a fresh startNewThread).
const activeThreadOverride = ref<{
  threadId: string;
  explicit: boolean;
} | null>(null);

const stableLabels = useShallowStableRef(computed(() => props.labels));

const mergedLabels = computed<CopilotChatLabels>(() => ({
  ...CopilotChatDefaultLabels,
  ...parentConfigValue.value?.labels,
  ...stableLabels.value,
}));

const resolvedAgentId = computed(
  () => props.agentId ?? parentConfigValue.value?.agentId ?? DEFAULT_AGENT_ID,
);

const fallbackThreadId = randomUUID();
const resolvedThreadId = computed(() => {
  if (propIsAuthoritative.value) return props.threadId as string;
  if (activeThreadOverride.value) return activeThreadOverride.value.threadId;
  if (props.threadId) return props.threadId;
  if (parentConfigValue.value?.threadId)
    return parentConfigValue.value.threadId;
  return fallbackThreadId;
});

const resolvedHasExplicitThreadId = computed(() => {
  if (propIsAuthoritative.value) return true;
  const own = activeThreadOverride.value
    ? activeThreadOverride.value.explicit
    : props.hasExplicitThreadId !== undefined
      ? props.hasExplicitThreadId
      : !!props.threadId;
  return own || !!parentConfigValue.value?.hasExplicitThreadId;
});

const shouldCreateModalState = computed(
  () => props.isModalDefaultOpen !== undefined,
);
const resolvedDefaultOpen = computed(() => props.isModalDefaultOpen ?? true);

const internalModalOpen = ref<boolean>(
  parentConfigValue.value?.isModalOpen ?? resolvedDefaultOpen.value,
);

function setInternalModalOpen(open: boolean) {
  internalModalOpen.value = open;
}

const resolvedIsModalOpen = computed(() =>
  shouldCreateModalState.value
    ? internalModalOpen.value
    : parentConfigValue.value?.isModalOpen,
);
const resolvedSetModalOpen = computed(() =>
  shouldCreateModalState.value
    ? setInternalModalOpen
    : parentConfigValue.value?.setModalOpen,
);

function setActiveThreadId(threadId: string, options?: { explicit?: boolean }) {
  if (propIsAuthoritative.value) {
    console.warn(
      "[CopilotKit] Ignoring setActiveThreadId(): threadId is controlled " +
        "via the `threadId` prop on CopilotChatConfigurationProvider.",
    );
    return;
  }
  activeThreadOverride.value = {
    threadId,
    explicit: options?.explicit ?? true,
  };
}

function startNewThread() {
  if (propIsAuthoritative.value) {
    console.warn(
      "[CopilotKit] Ignoring startNewThread(): threadId is controlled via " +
        "the `threadId` prop on CopilotChatConfigurationProvider.",
    );
    return;
  }
  activeThreadOverride.value = { threadId: randomUUID(), explicit: false };
}

const configurationValue = computed<CopilotChatConfigurationValue>(() => ({
  labels: mergedLabels.value,
  agentId: resolvedAgentId.value,
  threadId: resolvedThreadId.value,
  hasExplicitThreadId: resolvedHasExplicitThreadId.value,
  isModalOpen: resolvedIsModalOpen.value,
  setModalOpen: resolvedSetModalOpen.value,
  setActiveThreadId,
  startNewThread,
}));

provide(CopilotChatConfigurationKey, configurationValue);
</script>

<template>
  <slot />
</template>
