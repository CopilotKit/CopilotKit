<script setup lang="ts">
import { computed, onMounted, onScopeDispose, ref, watch } from "vue";
import {
  defineCopilotKitThreadsDrawer,
  COPILOTKIT_THREADS_DRAWER_TAG,
} from "@copilotkit/web-components/threads-drawer";
import type {
  CopilotKitThreadsDrawer as CopilotKitThreadsDrawerElement,
  DrawerThread,
  ThreadSelectedDetail,
  ArchiveDetail,
  UnarchiveDetail,
  DeleteDetail,
  RetryDetail,
  OpenChangeDetail,
} from "@copilotkit/web-components/threads-drawer";
import { DEFAULT_AGENT_ID } from "@copilotkit/shared";
import { useThreads } from "../../hooks/use-threads";
import type { Thread } from "../../hooks/use-threads";
import { useCopilotChatConfiguration } from "../../providers/useCopilotChatConfiguration";
import { useLicenseContext } from "../../providers/useLicenseContext";

const props = withDefaults(
  defineProps<{
    agentId?: string;
    onThreadSelect?: (threadId: string) => void;
    onNewThread?: () => void;
    onLicensed?: () => void;
    licenseUrl?: string;
    label?: string;
    limit?: number;
    dataTestId?: string;
  }>(),
  { dataTestId: "copilot-threads-drawer" },
);

const config = useCopilotChatConfiguration();
const license = useLicenseContext();

const licensed = computed(() => {
  const status = license.value.status;
  const present = status === "valid" || status === "expiring";
  return present && license.value.checkFeature("threads");
});
const licensePending = computed(() => license.value.status === null);

const resolvedAgentId = computed(
  () => props.agentId ?? config.value?.agentId ?? DEFAULT_AGENT_ID,
);
const activeThreadId = computed(() => config.value?.threadId ?? null);

const threadsApi = useThreads({
  agentId: resolvedAgentId,
  includeArchived: true,
  enabled: licensed,
  limit: () => props.limit,
});

function toDrawerThread(t: Thread): DrawerThread {
  return {
    id: t.id,
    name: t.name,
    archived: t.archived,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    ...(t.lastRunAt !== undefined ? { lastRunAt: t.lastRunAt } : {}),
  };
}
const drawerThreads = computed(() =>
  threadsApi.threads.value.map(toDrawerThread),
);

// Client-only element registration (SSR-safe). `mounted` gates the render.
const mounted = ref(false);
const elRef = ref<
  (CopilotKitThreadsDrawerElement & Record<string, unknown>) | null
>(null);
onMounted(() => {
  defineCopilotKitThreadsDrawer();
  mounted.value = true;
});

// Imperatively push object/array/boolean PROPERTIES (v-bind on a custom element
// would set string attributes for these). Runs whenever the element or any
// source changes.
watch(
  [
    elRef,
    drawerThreads,
    () => threadsApi.isLoading.value,
    () => threadsApi.listError.value,
    activeThreadId,
    licensed,
    licensePending,
    () => threadsApi.hasMoreThreads.value,
    () => threadsApi.isFetchingMoreThreads.value,
    () => config.value?.drawerOpen ?? false,
    () => props.label,
    () => props.licenseUrl,
  ],
  () => {
    const el = elRef.value;
    if (!el) return;
    el.threads = drawerThreads.value;
    el.loading = threadsApi.isLoading.value || licensePending.value;
    el.error = threadsApi.listError.value?.message ?? null;
    el.activeThreadId = activeThreadId.value;
    el.licensed = licensed.value || licensePending.value;
    el.hasMore = threadsApi.hasMoreThreads.value;
    el.fetchingMore = threadsApi.isFetchingMoreThreads.value;
    el.open = config.value?.drawerOpen ?? false;
    if (props.label !== undefined) el.label = props.label;
    if (props.licenseUrl !== undefined) el.licenseUrl = props.licenseUrl;
  },
  { flush: "post", immediate: true },
);

// Announce drawer presence so the mobile header launcher renders. Register
// synchronously in setup (React parity: a mount-time effect) and de-register
// on scope dispose. Not gated on `mounted`: presence is independent of the
// client-only element registration.
const unregisterDrawer = config.value?.registerDrawer?.();
if (unregisterDrawer) onScopeDispose(unregisterDrawer);

// --- Outbound event handlers ------------------------------------------------
function focusChatInput() {
  const input = document.querySelector<HTMLTextAreaElement>(
    '[data-testid="copilot-chat-textarea"]',
  );
  input?.focus();
}

function onThreadSelected(event: Event) {
  const { threadId } = (event as CustomEvent<ThreadSelectedDetail>).detail;
  if (props.onThreadSelect) props.onThreadSelect(threadId);
  else config.value?.setActiveThreadId?.(threadId, { explicit: true });
  focusChatInput();
}
function onNewThread() {
  threadsApi.startNewThread();
  if (props.onNewThread) props.onNewThread();
  else config.value?.startNewThread?.();
}
function onArchive(event: Event) {
  const { threadId } = (event as CustomEvent<ArchiveDetail>).detail;
  void threadsApi
    .archiveThread(threadId)
    .catch((e) =>
      console.error("CopilotThreadsDrawer: archiveThread failed", e),
    );
}
function onUnarchive(event: Event) {
  const { threadId } = (event as CustomEvent<UnarchiveDetail>).detail;
  void threadsApi
    .unarchiveThread(threadId)
    .catch((e) =>
      console.error("CopilotThreadsDrawer: unarchiveThread failed", e),
    );
}
function onDelete(event: Event) {
  const { threadId } = (event as CustomEvent<DeleteDetail>).detail;
  const wasActive = threadId === activeThreadId.value;
  void threadsApi
    .deleteThread(threadId)
    .then(() => {
      if (wasActive) {
        threadsApi.startNewThread();
        if (props.onNewThread) props.onNewThread();
        else config.value?.startNewThread?.();
      }
    })
    .catch((e) =>
      console.error("CopilotThreadsDrawer: deleteThread failed", e),
    );
}
function onFilterChange() {
  threadsApi.refetchThreads();
}
function onRetry(event: Event) {
  const { scope } = (event as CustomEvent<RetryDetail>).detail;
  if (scope === "fetch-more") threadsApi.fetchMoreThreads();
  else threadsApi.refetchThreads();
}
function onLoadMore() {
  threadsApi.fetchMoreThreads();
}
function onOpenChange(event: Event) {
  const { open } = (event as CustomEvent<OpenChangeDetail>).detail;
  config.value?.setDrawerOpen?.(open);
}
function onLicensed() {
  props.onLicensed?.();
}

defineSlots<{
  default(): unknown;
  row(props: { thread: Thread }): unknown;
}>();
</script>

<template>
  <component
    :is="COPILOTKIT_THREADS_DRAWER_TAG"
    v-if="mounted"
    ref="elRef"
    :data-testid="dataTestId"
    @thread-selected="onThreadSelected"
    @new-thread="onNewThread"
    @archive="onArchive"
    @unarchive="onUnarchive"
    @delete="onDelete"
    @filter-change="onFilterChange"
    @retry="onRetry"
    @load-more="onLoadMore"
    @open-change="onOpenChange"
    @licensed="onLicensed"
  >
    <slot />
    <template v-if="$slots.row">
      <div
        v-for="t in threadsApi.threads.value"
        :key="t.id"
        :slot="`row:${t.id}`"
      >
        <slot name="row" :thread="t" />
      </div>
    </template>
  </component>
</template>
