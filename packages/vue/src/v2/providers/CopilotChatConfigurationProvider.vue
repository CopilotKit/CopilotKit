<script setup lang="ts">
import { computed, inject, provide, ref } from "vue";
import type { ComputedRef } from "vue";
import { DEFAULT_AGENT_ID, randomUUID } from "@copilotkit/shared";
import { CopilotChatConfigurationKey } from "./keys";
import { CopilotChatDefaultLabels } from "./types";
import type { CopilotChatConfigurationValue, CopilotChatLabels } from "./types";
import type { CopilotChatConfigurationProviderProps } from "./CopilotChatConfigurationProvider.types";
import { useShallowStableRef } from "../lib/shallow-stable";
import { isMobileViewport } from "../lib/is-mobile-viewport";

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

// Drawer presence + open state. The top-most provider owns the state; a nested
// provider proxies its parent so the whole chain shares one drawer.
const ownDrawerOpen = ref(false);
const ownDrawerCount = ref(0);

function ownSetDrawerOpen(open: boolean) {
  ownDrawerOpen.value = open;
  // Mobile mutual-exclusion: opening the drawer closes the chat modal.
  if (open && isMobileViewport()) {
    resolvedSetModalOpen.value?.(false);
  }
}

function ownRegisterDrawer(): () => void {
  ownDrawerCount.value += 1;
  return () => {
    ownDrawerCount.value = Math.max(0, ownDrawerCount.value - 1);
  };
}

const resolvedDrawerOpen = computed(() =>
  parentConfigValue.value
    ? parentConfigValue.value.drawerOpen
    : ownDrawerOpen.value,
);
const resolvedSetDrawerOpen = computed(() =>
  parentConfigValue.value
    ? parentConfigValue.value.setDrawerOpen
    : ownSetDrawerOpen,
);
const resolvedDrawerRegistered = computed(() =>
  parentConfigValue.value
    ? parentConfigValue.value.drawerRegistered
    : ownDrawerCount.value > 0,
);
const resolvedRegisterDrawer = computed(() =>
  parentConfigValue.value
    ? parentConfigValue.value.registerDrawer
    : ownRegisterDrawer,
);

// Public modal setter (mobile mutual-exclusion, other direction: opening the
// chat modal closes the drawer). Preserve the contract that it is `undefined`
// when this provider owns no modal state AND no parent provides one —
// CopilotChatToggleButton relies on that absence to fall back to its own
// local open-state. When a real modal setter exists (own `isModalDefaultOpen`
// state or an inherited parent setter), wrap it so opening the modal on
// mobile also closes the drawer.
//
// Note: this diverges from the React reference (CopilotChatConfigurationProvider.tsx),
// which keeps `setModalOpen` always-defined and always backed by internal state. We
// intentionally take the minimal Vue-local fix here — preserving the `undefined`
// contract CopilotChatToggleButton depends on — rather than also reworking
// `resolvedIsModalOpen`'s backing, to avoid changing bare-provider modal-open
// semantics.
const publicSetModalOpen = computed(() => {
  const base = resolvedSetModalOpen.value; // undefined when no modal state + no parent
  if (!base) return undefined;
  return (open: boolean) => {
    if (open && isMobileViewport()) {
      resolvedSetDrawerOpen.value?.(false);
    }
    base(open);
  };
});

const configurationValue = computed<CopilotChatConfigurationValue>(() => ({
  labels: mergedLabels.value,
  agentId: resolvedAgentId.value,
  threadId: resolvedThreadId.value,
  hasExplicitThreadId: resolvedHasExplicitThreadId.value,
  isModalOpen: resolvedIsModalOpen.value,
  setModalOpen: publicSetModalOpen.value,
  drawerOpen: resolvedDrawerOpen.value,
  setDrawerOpen: resolvedSetDrawerOpen.value,
  drawerRegistered: resolvedDrawerRegistered.value,
  registerDrawer: resolvedRegisterDrawer.value,
  setActiveThreadId,
  startNewThread,
}));

provide(CopilotChatConfigurationKey, configurationValue);
</script>

<template>
  <slot />
</template>
