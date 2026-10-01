<script setup lang="ts">
import { computed, inject, provide, ref, watch } from "vue";
import type { ComputedRef } from "vue";
import { CopilotChatConfigurationKey } from "./keys";
import type { CopilotChatConfigurationValue } from "./types";

/**
 * Gives a chat modal (`<CopilotPopup>` / `<CopilotSidebar>` with
 * `threads-drawer`) its own threads drawer, hosted as an overlay inside the
 * modal.
 *
 * Inside the scope the drawer fields (`drawerOpen`, `setDrawerOpen`,
 * `drawerRegistered`, `registerDrawer`) are local to the modal, so the existing
 * drawer wrapper and header launcher work unchanged while:
 *
 * - a page-level `<CopilotThreadsDrawer>` elsewhere keeps its own, separate
 *   open state and registration, and
 * - opening the in-modal drawer never runs the provider's mobile modal/drawer
 *   mutual exclusion, which would close the very modal the drawer lives in.
 *
 * It also sets `ɵdrawerOverlay`, and closes the drawer whenever the modal
 * closes so it never reopens already expanded. With `enabled` false (or no
 * chat configuration in scope) the parent configuration passes through.
 */
const props = withDefaults(defineProps<{ enabled?: boolean }>(), {
  enabled: true,
});

const parentConfig = inject<ComputedRef<CopilotChatConfigurationValue> | null>(
  CopilotChatConfigurationKey,
  null,
);

const drawerOpen = ref(false);
const drawerCount = ref(0);

function setDrawerOpen(open: boolean) {
  drawerOpen.value = open;
}

function registerDrawer(): () => void {
  drawerCount.value += 1;
  return () => {
    drawerCount.value = Math.max(0, drawerCount.value - 1);
  };
}

watch(
  () => parentConfig?.value?.isModalOpen ?? false,
  (isModalOpen) => {
    if (!isModalOpen) drawerOpen.value = false;
  },
);

const configurationValue = computed(() => {
  const parent = parentConfig?.value;
  if (!parent || !props.enabled) return parent as CopilotChatConfigurationValue;
  return {
    ...parent,
    drawerOpen: drawerOpen.value,
    setDrawerOpen,
    drawerRegistered: drawerCount.value > 0,
    registerDrawer,
    ɵdrawerOverlay: true,
  } satisfies CopilotChatConfigurationValue;
});

if (parentConfig) {
  provide(CopilotChatConfigurationKey, configurationValue);
}
</script>

<template>
  <slot />
</template>
