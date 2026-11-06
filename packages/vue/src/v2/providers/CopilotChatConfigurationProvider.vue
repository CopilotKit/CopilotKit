<script setup lang="ts">
import {
  computed,
  inject,
  onBeforeUnmount,
  onMounted,
  provide,
  shallowRef,
  watch,
} from "vue";
import { ɵChatConfigurationStore } from "@copilotkit/core";
import type { ComputedRef } from "vue";
import { CopilotChatConfigurationKey, CopilotKitKey } from "./keys";
import { ChatConfigurationStoreKey } from "./chat-configuration-store-key";
import { CopilotChatDefaultLabels } from "./types";
import type { CopilotChatConfigurationValue, CopilotChatLabels } from "./types";
import type { CopilotChatConfigurationProviderProps } from "./CopilotChatConfigurationProvider.types";
import { useShallowStableRef } from "../lib/shallow-stable";

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

// Core owns thread, agent, modal and drawer resolution across the provider
// chain; this component feeds it props and projects its snapshot.
const readOptions = () => ({
  agentId: props.agentId,
  threadId: props.threadId,
  hasExplicitThreadId: props.hasExplicitThreadId,
  isModalDefaultOpen: props.isModalDefaultOpen,
});
const store = new ɵChatConfigurationStore(
  readOptions(),
  inject(ChatConfigurationStoreKey, null),
);
const snapshot = shallowRef(store.getSnapshot());
const unsubscribe = store.subscribe(() => {
  snapshot.value = store.getSnapshot();
});
watch(readOptions, (options) => store.update(options));
onBeforeUnmount(() => {
  unsubscribe();
  store.dispose();
});

const stableLabels = useShallowStableRef(computed(() => props.labels));

const mergedLabels = computed<CopilotChatLabels>(() => ({
  ...CopilotChatDefaultLabels,
  ...parentConfig?.value?.labels,
  ...stableLabels.value,
}));

// Tell Core which Thread this view shows, so captured interactions can link
// to it. Works without a CopilotKitProvider: then there is nothing to register.
const copilotKitContext = inject(CopilotKitKey, null);
onMounted(() => {
  watch(
    () => copilotKitContext?.copilotkit.value,
    (core, _previous, onCleanup) => {
      if (!core) return;
      onCleanup(store.bindOpenThread(core));
    },
    { immediate: true },
  );
});

const configurationValue = computed<CopilotChatConfigurationValue>(() => ({
  labels: mergedLabels.value,
  agentId: snapshot.value.agentId,
  threadId: snapshot.value.threadId,
  hasExplicitThreadId: snapshot.value.hasExplicitThreadId,
  isModalOpen: snapshot.value.isModalOpen,
  setModalOpen: store.setModalOpen,
  drawerOpen: snapshot.value.drawerOpen,
  setDrawerOpen: store.setDrawerOpen,
  drawerRegistered: snapshot.value.drawerRegistered,
  registerDrawer: store.registerDrawer,
  setActiveThreadId: store.setActiveThreadId,
  startNewThread: store.startNewThread,
}));

provide(CopilotChatConfigurationKey, configurationValue);
provide(ChatConfigurationStoreKey, store);
</script>

<template>
  <slot />
</template>
