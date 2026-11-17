<script setup lang="ts">
import { computed, onMounted, onScopeDispose, ref, watchEffect } from "vue";
// NOTE: the `<copilotkit-threads-drawer>` element is a Lit custom element whose
// module evaluates `class ... extends HTMLElement` at import time, which throws
// under SSR (Node has no DOM). It is therefore imported LAZILY (client-only,
// inside onMounted) rather than statically, so that importing `@copilotkit/vue`
// stays SSR-safe for every consumer (e.g. Nuxt). Only the erased `import type`
// below is kept at module scope.
import type {
  CopilotKitThreadsDrawer as CopilotKitThreadsDrawerElement,
  ThreadSelectedDetail,
  ArchiveDetail,
  UnarchiveDetail,
  DeleteDetail,
  RetryDetail,
  OpenChangeDetail,
} from "@copilotkit/web-components/threads-drawer";
// TODO(ENT-1051): import `CollapseChangeDetail` from
// "@copilotkit/web-components/threads-drawer" once the parallel element PR that
// adds the collapse feature (property `collapsible` + event `collapse-change`)
// lands and is published; declared locally here because the built element types
// in this worktree predate it.
type CollapseChangeDetail = { collapsed: boolean };
import {
  ɵcreateThreadsDrawerActions,
  ɵgetThreadsDrawerElementProps,
  ɵresolveAgentId,
  ɵresolveThreadsLicense,
  ɵtoDrawerThread,
} from "@copilotkit/core";
import { useThreads } from "../../hooks/use-threads";
import type { Thread } from "../../hooks/use-threads";
import { useCopilotChatConfiguration } from "../../providers/useCopilotChatConfiguration";
import { useCopilotKit } from "../../providers/useCopilotKit";
import { useLicenseContext } from "../../providers/useLicenseContext";

const props = withDefaults(
  defineProps<{
    agentId?: string;
    onThreadSelect?: (threadId: string) => void;
    onNewThread?: () => void;
    onLicensed?: () => void;
    licenseUrl?: string;
    label?: string;
    /**
     * Heading rendered above the thread list (element attribute
     * `recent-label`). Defaults to the element's own `"Recent Conversations"`
     * when omitted.
     */
    recentLabel?: string;
    /**
     * Whether the drawer offers a collapse toggle. Bound to the element's
     * `collapsible` PROPERTY. When `false`, the drawer has no collapse toggle
     * and is always expanded. Defaults to `true`.
     *
     * NOTE: this MUST carry an explicit `true` default below. Vue coerces an
     * omitted `Boolean` prop to `false` (not `undefined`), so without the
     * default the `!== undefined` guard would always fire and force the element
     * to `collapsible=false` — silently disabling collapse. Defaulting to `true`
     * restores the element's own default when the prop is omitted.
     */
    collapsible?: boolean;
    limit?: number;
    dataTestId?: string;
  }>(),
  { dataTestId: "copilot-threads-drawer", collapsible: true },
);

const emit = defineEmits<{
  /**
   * Emitted when the drawer's collapsed state changes (mirrors the element's
   * `collapse-change` event), carrying the new collapsed state.
   */
  "collapse-change": [collapsed: boolean];
}>();

const config = useCopilotChatConfiguration();
const license = useLicenseContext();

const { copilotkit } = useCopilotKit();

// `unknown` (an unrecovered entitlement lookup) counts as licensed so the
// threads endpoint decides; `null` (not reported yet) is pending, until a
// runtime connects without reporting a license (no Intelligence).
const threadsLicense = computed(() =>
  ɵresolveThreadsLicense(license.value, copilotkit.value.ɵruntimeInfo),
);
const licensed = computed(() => threadsLicense.value.licensed);
const licensePending = computed(() => threadsLicense.value.licensePending);

const resolvedAgentId = computed(() =>
  ɵresolveAgentId({
    agentId: props.agentId,
    chatAgentId: config.value?.agentId,
  }),
);
const activeThreadId = computed(() => config.value?.threadId ?? null);

// Provider-less fallback: without a surrounding chat configuration there is
// no shared open-state to bind to, so the wrapper keeps its own local
// open-state. It starts CLOSED — matching the provider's own default — so a
// bare `<CopilotThreadsDrawer>` does not render stuck-open and the element's
// open-change events still toggle it.
const localDrawerOpen = ref(false);
const drawerOpen = computed(() =>
  config.value ? config.value.drawerOpen : localDrawerOpen.value,
);
function setDrawerOpen(open: boolean) {
  if (config.value) config.value.setDrawerOpen?.(open);
  else localDrawerOpen.value = open;
}

const threadsApi = useThreads({
  agentId: resolvedAgentId,
  includeArchived: true,
  enabled: licensed,
  limit: () => props.limit,
});

const drawerThreads = computed(() =>
  threadsApi.threads.value.map(ɵtoDrawerThread),
);

// Client-only element registration (SSR-safe). The element module is imported
// lazily here (never at module scope — see the import note above) so SSR never
// evaluates its `extends HTMLElement`. `elementTag` holds the resolved custom-
// element tag and `mounted` gates the render; both are set only after the
// dynamic import resolves on the client.
const mounted = ref(false);
const elementTag = ref<string | null>(null);
const elRef = ref<CopilotKitThreadsDrawerElement | null>(null);
onMounted(async () => {
  const mod = await import("@copilotkit/web-components/threads-drawer");
  mod.defineCopilotKitThreadsDrawer();
  elementTag.value = mod.COPILOTKIT_THREADS_DRAWER_TAG;
  mounted.value = true;
});

// Imperatively push object/array/boolean PROPERTIES (v-bind on a custom element
// would set string attributes for these). Re-runs whenever the element or any
// reactive value read in the body changes (auto-tracked by watchEffect).
watchEffect(
  () => {
    const el = elRef.value;
    if (!el) return;
    el.threads = drawerThreads.value;
    const elementProps = ɵgetThreadsDrawerElementProps({
      loading: threadsApi.isLoading.value,
      licensed: licensed.value,
      licensePending: licensePending.value,
    });
    el.loading = elementProps.loading;
    el.error = threadsApi.listError.value?.message ?? null;
    el.activeThreadId = activeThreadId.value;
    el.licensed = elementProps.licensed;
    el.hasMore = threadsApi.hasMoreThreads.value;
    el.fetchingMore = threadsApi.isFetchingMoreThreads.value;
    // Dedicated fetch-more error channel: drives the element's inline
    // "couldn't load more — retry" panel without disturbing the loaded list.
    el.fetchMoreError = threadsApi.fetchMoreError.value?.message ?? null;
    el.open = drawerOpen.value;
    if (props.label !== undefined) el.label = props.label;
    if (props.licenseUrl !== undefined) el.licenseUrl = props.licenseUrl;
    // `collapsible` is a default-true boolean PROPERTY (like `licensed`); leave
    // the element's own default in place when the prop is omitted.
    if (props.collapsible !== undefined) {
      // TODO(ENT-1051): drop the intersection cast once the published element
      // type declares `collapsible` (see the local CollapseChangeDetail note).
      (
        el as CopilotKitThreadsDrawerElement & { collapsible: boolean }
      ).collapsible = props.collapsible;
    }
  },
  { flush: "post" },
);

// Announce drawer presence so the mobile header launcher renders. Register
// synchronously in setup (React parity: a mount-time effect) and de-register
// on scope dispose. Not gated on `mounted`: presence is independent of the
// client-only element registration.
const unregisterDrawer = config.value?.registerDrawer?.();
if (unregisterDrawer) onScopeDispose(unregisterDrawer);

// --- Outbound event handlers ------------------------------------------------
// Core owns the drawer actions; they read the latest values at call time.
const actions = ɵcreateThreadsDrawerActions({
  getThreads: () => threadsApi,
  getConfig: () => config.value,
  getCallbacks: () => ({
    onThreadSelect: props.onThreadSelect,
    onNewThread: props.onNewThread,
  }),
  getElement: () => elRef.value,
});

function onThreadSelected(event: Event) {
  const { threadId } = (event as CustomEvent<ThreadSelectedDetail>).detail;
  actions.selectThread(threadId);
}
const handleNewThread = actions.newThread;
function onArchive(event: Event) {
  actions.archive((event as CustomEvent<ArchiveDetail>).detail.threadId);
}
function onUnarchive(event: Event) {
  actions.unarchive((event as CustomEvent<UnarchiveDetail>).detail.threadId);
}
function onDelete(event: Event) {
  actions.remove((event as CustomEvent<DeleteDetail>).detail.threadId);
}
const onFilterChange = actions.refetch;
function onCollapseChange(event: Event) {
  const { collapsed } = (event as CustomEvent<CollapseChangeDetail>).detail;
  emit("collapse-change", collapsed);
}
function onRetry(event: Event) {
  actions.retry((event as CustomEvent<RetryDetail>).detail.scope);
}
const onLoadMore = actions.loadMore;
function onOpenChange(event: Event) {
  const { open } = (event as CustomEvent<OpenChangeDetail>).detail;
  setDrawerOpen(open);
}
function handleLicensed() {
  props.onLicensed?.();
}

defineSlots<{
  default(): unknown;
  /**
   * Optional per-row content. When provided, this slot is rendered as
   * light-DOM children with `slot="row:{id}"` for EVERY thread in the list,
   * so the element projects it in place of the default row for all rows.
   *
   * Unlike React's `renderRow` (which returns `ReactNode | null` and can
   * fall back to the element's built-in row on a per-thread basis by
   * returning `null`), Vue's scoped slot is all-or-nothing: there is no
   * per-row escape hatch back to the element default once the slot is
   * defined. This is an intentional Vue-idiom divergence, not a bug — if a
   * consumer needs per-row fallback, they should replicate the default row
   * markup themselves inside the slot for the threads they don't want to
   * customize.
   */
  row(props: { thread: Thread }): unknown;
}>();
</script>

<template>
  <component
    :is="elementTag"
    v-if="mounted"
    ref="elRef"
    :data-testid="dataTestId"
    :recent-label="recentLabel"
    @thread-selected="onThreadSelected"
    @new-thread="handleNewThread"
    @archive="onArchive"
    @unarchive="onUnarchive"
    @delete="onDelete"
    @filter-change="onFilterChange"
    @collapse-change="onCollapseChange"
    @retry="onRetry"
    @load-more="onLoadMore"
    @open-change="onOpenChange"
    @licensed="handleLicensed"
  >
    <slot />
    <!--
      When the `row` slot is defined, it is projected for EVERY thread (no
      per-row fallback to the element default) — see the JSDoc on the `row`
      slot above for the React `renderRow` comparison.
    -->
    <template v-if="$slots.row">
      <div
        v-for="t in threadsApi.threads.value"
        :key="t.id"
        v-bind="{ slot: `row:${t.id}` }"
      >
        <slot name="row" :thread="t" />
      </div>
    </template>
  </component>
</template>
