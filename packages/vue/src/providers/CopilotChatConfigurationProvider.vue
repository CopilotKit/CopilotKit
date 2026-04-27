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
const stableLabels = useShallowStableRef(computed(() => props.labels));

const mergedLabels = computed<CopilotChatLabels>(() => ({
  ...CopilotChatDefaultLabels,
  ...parentConfigValue.value?.labels,
  ...stableLabels.value,
}));

const resolvedAgentId = computed(
  () => props.agentId ?? parentConfigValue.value?.agentId ?? DEFAULT_AGENT_ID,
);

const resolvedThreadId = computed(() => {
  if (props.threadId) return props.threadId;
  if (parentConfigValue.value?.threadId)
    return parentConfigValue.value.threadId;
  return randomUUID();
});

const resolvedHasExplicitThreadId = computed(() => {
  const ownExplicit =
    props.hasExplicitThreadId !== undefined
      ? props.hasExplicitThreadId
      : !!props.threadId;
  return ownExplicit || !!parentConfigValue.value?.hasExplicitThreadId;
});

const shouldCreateModalState = props.isModalDefaultOpen !== undefined;
const resolvedDefaultOpen = props.isModalDefaultOpen ?? true;

const internalModalOpen = ref<boolean>(
  parentConfigValue.value?.isModalOpen ?? resolvedDefaultOpen,
);

function setInternalModalOpen(open: boolean) {
  internalModalOpen.value = open;
}

const resolvedIsModalOpen = computed(() =>
  shouldCreateModalState
    ? internalModalOpen.value
    : parentConfigValue.value?.isModalOpen,
);
const resolvedSetModalOpen = computed(() =>
  shouldCreateModalState
    ? setInternalModalOpen
    : parentConfigValue.value?.setModalOpen,
);

const configurationValue = computed<CopilotChatConfigurationValue>(() => ({
  labels: mergedLabels.value,
  agentId: resolvedAgentId.value,
  threadId: resolvedThreadId.value,
  hasExplicitThreadId: resolvedHasExplicitThreadId.value,
  isModalOpen: resolvedIsModalOpen.value,
  setModalOpen: resolvedSetModalOpen.value,
}));

provide(CopilotChatConfigurationKey, configurationValue);
</script>

<template>
  <slot />
</template>
