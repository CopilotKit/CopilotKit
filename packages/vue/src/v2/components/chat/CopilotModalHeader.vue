<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useAttrs } from "vue";
import { useCopilotChatConfiguration } from "../../providers/useCopilotChatConfiguration";
import { CopilotChatDefaultLabels } from "../../providers/types";
import { MOBILE_MAX_WIDTH_QUERY } from "../../lib/is-mobile-viewport";
import CopilotModalHeaderCloseButton from "./CopilotModalHeaderCloseButton";
import CopilotModalHeaderTitle from "./CopilotModalHeaderTitle";
import { IconPanelLeftOpen } from "../icons";
import type {
  CopilotModalHeaderCloseButtonSlotProps,
  CopilotModalHeaderLayoutSlotProps,
  CopilotModalHeaderProps,
  CopilotModalHeaderTitleContentSlotProps,
} from "./types";

defineOptions({ inheritAttrs: false });

const props = defineProps<CopilotModalHeaderProps>();

defineSlots<{
  "title-content"?: (props: CopilotModalHeaderTitleContentSlotProps) => unknown;
  "close-button"?: (props: CopilotModalHeaderCloseButtonSlotProps) => unknown;
  layout?: (props: CopilotModalHeaderLayoutSlotProps) => unknown;
}>();

const attrs = useAttrs();
const config = useCopilotChatConfiguration();

const resolvedTitle = computed(
  () =>
    props.title ??
    config.value?.labels.modalHeaderTitle ??
    CopilotChatDefaultLabels.modalHeaderTitle,
);
const headerClass = computed(() => [
  "copilotKitHeader cpk-modal-header",
  attrs.class,
]);
const headerAttrs = computed(() => {
  const { class: _className, ...rest } = attrs;
  return rest;
});

function handleClose() {
  config.value?.setModalOpen?.(false);
}

// Tracks whether the viewport is in the mobile range (MOBILE_MAX_WIDTH_QUERY) — the same
// breakpoint the drawer + chat coordination use. SSR-safe: starts `false`
// (desktop) so the server render and first client render agree, then syncs
// on mount and on viewport changes.
const isMobile = ref(false);
let mobileMediaQuery: MediaQueryList | null = null;

function syncIsMobile() {
  if (mobileMediaQuery) {
    isMobile.value = mobileMediaQuery.matches;
  }
}

onMounted(() => {
  if (
    typeof window === "undefined" ||
    typeof window.matchMedia !== "function"
  ) {
    return;
  }
  mobileMediaQuery = window.matchMedia(MOBILE_MAX_WIDTH_QUERY);
  mobileMediaQuery.addEventListener("change", syncIsMobile);
  syncIsMobile();
});

onBeforeUnmount(() => {
  mobileMediaQuery?.removeEventListener("change", syncIsMobile);
  mobileMediaQuery = null;
});

// The thread-list launcher renders ONLY when a <CopilotThreadsDrawer> wrapper
// has registered with the chat configuration AND the viewport is mobile. On
// desktop the drawer is an in-flow, persistent panel (it ignores `open`), so
// an "open the drawer" launcher there is a dead no-op — it only does
// anything for the mobile off-canvas drawer. Chats with no drawer get no
// launcher and no behavior change.
const showDrawerLauncher = computed(
  () => (config.value?.drawerRegistered ?? false) && isMobile.value,
);

function toggleDrawer() {
  config.value?.setDrawerOpen?.(!config.value?.drawerOpen);
}
</script>

<template>
  <header
    data-copilotkit
    data-slot="copilot-modal-header"
    :class="headerClass"
    v-bind="headerAttrs"
  >
    <slot name="layout" :title="resolvedTitle" :on-close="handleClose">
      <div class="cpk-modal-header-content">
        <div class="cpk-modal-header-start">
          <button
            v-if="showDrawerLauncher"
            type="button"
            data-testid="drawer-launcher"
            class="cpk-modal-header-drawer-launcher"
            :aria-expanded="config?.drawerOpen ?? false"
            :aria-label="
              config?.labels.modalHeaderThreadsButtonLabel ??
              CopilotChatDefaultLabels.modalHeaderThreadsButtonLabel
            "
            @click="toggleDrawer"
          >
            <IconPanelLeftOpen
              class="cpk-modal-header-drawer-launcher-icon"
              aria-hidden="true"
            />
          </button>
          <span v-else aria-hidden="true" />
        </div>
        <div class="cpk-modal-header-center">
          <slot name="title-content" :title="resolvedTitle">
            <CopilotModalHeaderTitle>
              {{ resolvedTitle }}
            </CopilotModalHeaderTitle>
          </slot>
        </div>
        <div class="cpk-modal-header-end">
          <slot name="close-button" :on-close="handleClose">
            <CopilotModalHeaderCloseButton @click="handleClose" />
          </slot>
        </div>
      </div>
    </slot>
  </header>
</template>
