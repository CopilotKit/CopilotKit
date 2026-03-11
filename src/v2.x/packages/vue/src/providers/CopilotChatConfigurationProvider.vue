<script setup lang="ts">
import { computed, getCurrentInstance, inject, provide, ref, type ComputedRef } from "vue";
import { DEFAULT_AGENT_ID, randomUUID } from "@copilotkitnext/shared";
import { CopilotChatConfigurationKey } from "./keys";
import {
  CopilotChatDefaultLabels,
  type CopilotChatConfigurationValue,
  type CopilotChatLabels,
} from "./types";
import type { CopilotChatConfigurationProviderProps } from "./CopilotChatConfigurationProvider.types";

const props = withDefaults(
  defineProps<CopilotChatConfigurationProviderProps>(),
  {},
);

const parentConfig = inject<ComputedRef<CopilotChatConfigurationValue> | null>(
  CopilotChatConfigurationKey,
  null,
);
const parentConfigValue = computed(() => parentConfig?.value ?? null);

const mergedLabels = computed<CopilotChatLabels>(() => ({
  ...CopilotChatDefaultLabels,
  ...(parentConfigValue.value?.labels ?? {}),
  ...(props.labels ?? {}),
}));

const resolvedAgentId = computed(
  () => props.agentId ?? parentConfigValue.value?.agentId ?? DEFAULT_AGENT_ID,
);

const resolvedThreadId = computed(() => {
  if (props.threadId) return props.threadId;
  if (parentConfigValue.value?.threadId) return parentConfigValue.value.threadId;
  return randomUUID();
});

const initialVNodeProps = getCurrentInstance()?.vnode.props ?? {};
const shouldCreateModalState = Object.prototype.hasOwnProperty.call(
  initialVNodeProps,
  "isModalDefaultOpen",
)
  || Object.prototype.hasOwnProperty.call(initialVNodeProps, "is-modal-default-open");
const resolvedDefaultOpen = props.isModalDefaultOpen ?? true;

const internalModalOpen = ref<boolean>(
  parentConfigValue.value?.isModalOpen ?? resolvedDefaultOpen,
);

function setInternalModalOpen(open: boolean) {
  internalModalOpen.value = open;
}

const resolvedIsModalOpen = computed(() =>
  shouldCreateModalState ? internalModalOpen.value : parentConfigValue.value?.isModalOpen,
);
const resolvedSetModalOpen = computed(() =>
  shouldCreateModalState ? setInternalModalOpen : parentConfigValue.value?.setModalOpen,
);

const configurationValue = computed<CopilotChatConfigurationValue>(() => ({
  labels: mergedLabels.value,
  agentId: resolvedAgentId.value,
  threadId: resolvedThreadId.value,
  isModalOpen: resolvedIsModalOpen.value,
  setModalOpen: resolvedSetModalOpen.value,
}));

provide(CopilotChatConfigurationKey, configurationValue);
</script>

<template>
  <slot />
</template>
