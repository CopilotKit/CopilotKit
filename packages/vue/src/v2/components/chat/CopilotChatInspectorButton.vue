<script setup lang="ts">
/**
 * React's `CopilotChatInspectorButton`: the Inspector shortcut in the
 * assistant message toolbar. A click (or Enter or Space) opens the message in
 * the Inspector. Hovering the button, or ArrowDown, shows a menu that
 * explains it and can hide the shortcut until the page reloads.
 *
 * @internal
 */
import { computed, onBeforeUnmount, ref, shallowRef } from "vue";
import { useCopilotChatConfiguration } from "../../providers/useCopilotChatConfiguration";
import { CopilotChatDefaultLabels } from "../../providers/types";
import { IconEyeOff, IconWrench } from "../icons";
import CopilotDropdownMenuContent from "../ui/CopilotDropdownMenuContent.vue";
import type {
  CopilotDropdownMenuDismissReason,
  CopilotDropdownMenuEntry,
  CopilotDropdownMenuItem,
} from "../ui/dropdown-menu";
import CopilotTooltip from "../ui/CopilotTooltip.vue";
import { useCopilotId } from "../ui/use-id";
import { hideInspectorShortcuts } from "./inspector-shortcuts";

defineOptions({ inheritAttrs: false });

const props = defineProps<{
  /** Name of the menu item that inspects; defaults to the label. */
  title?: string;
  disabled?: boolean;
}>();

const emit = defineEmits<{ click: [] }>();

const config = useCopilotChatConfiguration();
const labels = computed(() => config.value?.labels ?? CopilotChatDefaultLabels);
const menuId = useCopilotId("cpk-inspector-menu");
const triggerId = useCopilotId("cpk-inspector-button");
const kiteId = useCopilotId("cpk-inspector-kite");
const trigger = shallowRef<HTMLButtonElement | null>(null);
const open = ref(false);
const dark = ref(false);
const initialFocus = ref<"first" | "none">("none");
let closeTimer: ReturnType<typeof setTimeout> | null = null;
// Hover opens it without moving focus, and leaving closes it again.
let openedByHover = false;

const cancelClose = () => {
  if (closeTimer !== null) clearTimeout(closeTimer);
  closeTimer = null;
};
onBeforeUnmount(cancelClose);

const changeOpen = (next: boolean) => {
  cancelClose();
  if (next) dark.value = !!trigger.value?.closest(".dark");
  open.value = next;
};

const scheduleClose = () => {
  cancelClose();
  closeTimer = setTimeout(() => {
    // Keep the panel available while the keyboard is interacting with it.
    if (openedByHover) open.value = false;
  }, 180);
};

const items = computed<CopilotDropdownMenuEntry[]>(() => [
  {
    label: props.title || labels.value.assistantMessageToolbarInspectorLabel,
    action: () => emit("click"),
    class: "cpk-inspector-button-menu-item cpk-inspector-button-inspect-item",
  },
  {
    label: labels.value.assistantMessageToolbarInspectorHideLabel,
    action: hideInspectorShortcuts,
    class: "cpk-inspector-button-menu-item cpk-inspector-button-hide-item",
  },
]);

const isInspectItem = (item: CopilotDropdownMenuItem) =>
  item === items.value[0];

function onPointerEnter(event: PointerEvent) {
  if (props.disabled || event.pointerType === "touch") return;
  openedByHover = true;
  initialFocus.value = "none";
  changeOpen(true);
}

function onClick() {
  changeOpen(false);
  emit("click");
}

function onKeyDown(event: KeyboardEvent) {
  openedByHover = false;
  if (event.key === "Enter" || event.key === " ") {
    // Enter and Space inspect, as a click does, instead of opening the menu.
    event.preventDefault();
    onClick();
  } else if (event.key === "ArrowDown") {
    event.preventDefault();
    initialFocus.value = "first";
    if (open.value) {
      // Open already from hover: move into it.
      open.value = false;
      queueMicrotask(() => changeOpen(true));
    } else {
      changeOpen(true);
    }
  }
}

function onSelect(item: CopilotDropdownMenuItem) {
  const returnFocus = !openedByHover;
  changeOpen(false);
  item.action?.();
  if (returnFocus && !isInspectItem(item)) trigger.value?.focus();
}

function onDismiss(reason: CopilotDropdownMenuDismissReason) {
  const returnFocus = !openedByHover && reason !== "outside";
  changeOpen(false);
  if (returnFocus) trigger.value?.focus();
}

const ariaLabel = computed(
  () =>
    `${labels.value.assistantMessageToolbarInspectorTitle} (${labels.value.assistantMessageToolbarInspectorLocalOnlyLabel.toLowerCase()})`,
);

const descriptionFor = (item: CopilotDropdownMenuItem) =>
  isInspectItem(item)
    ? labels.value.assistantMessageToolbarInspectorDescription
    : labels.value.assistantMessageToolbarInspectorHideDescription;
</script>

<template>
  <button
    :id="triggerId"
    ref="trigger"
    v-bind="$attrs"
    type="button"
    :disabled="disabled"
    data-testid="copilot-inspector-button"
    class="cpk-button cpk-button-assistant-message-toolbar cpk-button-size-icon cpk-inspector-button"
    :aria-label="ariaLabel"
    aria-haspopup="menu"
    :aria-expanded="open"
    :aria-controls="open ? menuId : undefined"
    :data-state="open ? 'open' : 'closed'"
    @pointerenter="onPointerEnter"
    @pointerleave="scheduleClose"
    @pointerdown.prevent
    @click="onClick"
    @keydown="onKeyDown"
  >
    <IconWrench
      aria-hidden="true"
      class="cpk-inspector-button-icon"
      data-testid="copilot-inspector-icon"
    />
  </button>
  <CopilotDropdownMenuContent
    :id="menuId"
    :open="open"
    :anchor="trigger"
    :items="items"
    :menu-id="menuId"
    :labelled-by="triggerId"
    side="top"
    align="start"
    :side-offset="6"
    :initial-focus="initialFocus"
    class="cpk-inspector-button-menu"
    :class="{ dark }"
    @select="onSelect"
    @dismiss="onDismiss"
    @pointer-enter="cancelClose"
    @pointer-leave="scheduleClose"
    @keydown="openedByHover = false"
  >
    <template #header>
      <div
        data-slot="dropdown-menu-label"
        class="cpk-dropdown-menu-label cpk-inspector-button-menu-header"
      >
        <span class="cpk-inspector-button-menu-title">
          {{ labels.assistantMessageToolbarInspectorTitle }}
        </span>
        <CopilotTooltip
          :content="labels.assistantMessageToolbarInspectorLocalOnlyDescription"
          side="top"
          :side-offset="6"
          :delay-duration="1000"
          :content-class="
            dark
              ? 'cpk-inspector-button-local-tooltip dark'
              : 'cpk-inspector-button-local-tooltip'
          "
        >
          <template #default="{ triggerProps }">
            <span
              tabindex="0"
              class="cpk-inspector-button-local-badge"
              v-bind="triggerProps"
            >
              {{ labels.assistantMessageToolbarInspectorLocalOnlyLabel }}
            </span>
          </template>
          <template #content>
            {{ labels.assistantMessageToolbarInspectorLocalOnlyDescription }}
          </template>
        </CopilotTooltip>
      </div>
      <div
        role="separator"
        aria-orientation="horizontal"
        data-slot="dropdown-menu-separator"
        class="cpk-dropdown-menu-separator"
      />
    </template>
    <template #item="{ item }">
      <!-- Matches the Inspector launcher artwork in web-inspector/src/assets/inspector-logo-kite.svg. -->
      <svg
        v-if="isInspectItem(item)"
        aria-hidden="true"
        class="cpk-inspector-button-kite-icon cpk-inspector-button-menu-item-icon"
        viewBox="4.57 3.36 17.8 17.8"
        fill="none"
      >
        <path
          d="M6.36084 10.9855C8.34277 8.393 9.98843 5.82939 10.6204 3.75914C10.6382 3.70281 10.7043 3.67888 10.7534 3.7114C12.9536 5.16894 16.9635 6.12833 20.5086 6.15085C20.5703 6.15124 20.6124 6.2114 20.5895 6.26829C19.4109 9.25938 17.9705 14.6189 17.9148 20.7392C17.9148 20.8301 17.7873 20.8627 17.7419 20.7837C15.7236 17.2522 9.26021 12.2898 6.39414 11.1186C6.34112 11.0968 6.32556 11.0313 6.36084 10.9855Z"
          :fill="`url(#${kiteId}-paint0_linear)`"
        />
        <path
          d="M13.0475 9.39974C9.95016 10.3806 7.11935 10.9259 6.44331 11.0498C6.40027 11.0577 6.39115 11.1172 6.43152 11.134C9.3203 12.3347 15.7516 17.2826 17.7511 20.7998C17.7551 20.8075 17.7647 20.8103 17.7728 20.8068C17.7809 20.803 17.7853 20.793 17.7819 20.7844L13.0475 9.39974Z"
          :fill="`url(#${kiteId}-paint1_linear)`"
        />
        <path
          d="M10.762 3.705C13.4137 5.15161 16.4787 5.80132 20.545 6.14367C20.5703 6.14585 20.5787 6.18008 20.5557 6.19197C20.0359 6.45923 17.0574 7.97512 14.8455 8.78701C14.2524 9.00453 13.6564 9.20632 13.0692 9.39249C13.0562 9.39656 13.0419 9.39015 13.0369 9.37774L10.7005 3.75979C10.6849 3.72196 10.7257 3.68538 10.762 3.705Z"
          :fill="`url(#${kiteId}-paint2_linear)`"
        />
        <path
          d="M10.7145 3.79041L17.8305 20.7659"
          stroke="#513C9F"
          stroke-width="0.17284"
          stroke-linecap="round"
        />
        <path
          d="M6.44531 11.0476C6.44531 11.0476 10.375 10.3422 14.0686 9.06804C17.7623 7.7939 20.5122 6.23373 20.5122 6.23373"
          stroke="#513C9F"
          stroke-width="0.17284"
          stroke-linecap="round"
        />
        <path
          d="M11.6914 5.93518L9.05534 14.7068M9.05534 14.7068H15.3203M9.05534 14.7068L0.15625 26.3646"
          stroke="#ABABAB"
          stroke-width="0.302474"
          stroke-linecap="round"
        />
        <path
          d="M6.02539 23.9646L4.85806 24.1287C5.46272 25.7287 6.70381 26.4276 8.18528 26.4276C11.8147 26.4276 10.707 22.3227 12.8103 22.3227C14.3358 22.3227 13.7155 25.6498 16.9992 25.6498C19.0029 25.6498 19.2028 23.631 18.8607 22.7625C18.8589 22.7572 18.8568 22.7524 18.8538 22.7476L18.3166 21.9253C18.2817 21.8706 18.1968 21.8912 18.1907 21.9562L18.0908 22.9529C18.0838 23.0222 18.0857 23.0913 18.0936 23.1605C18.1764 23.8491 18.2291 25.5202 16.9992 25.5202C15.7015 25.5202 15.3895 22.2362 12.8103 22.2362C9.78393 22.2362 10.1726 26.298 8.31487 26.298C7.08938 26.298 6.15447 24.9153 6.02539 23.9646Z"
          :fill="`url(#${kiteId}-paint3_linear)`"
        />
        <defs>
          <linearGradient
            :id="`${kiteId}-paint0_linear`"
            x1="15.5372"
            y1="5.0278"
            x2="12.0802"
            y2="14.534"
            gradientUnits="userSpaceOnUse"
          >
            <stop stop-color="#6430AB" />
            <stop offset="1" stop-color="#AA89D8" />
          </linearGradient>
          <linearGradient
            :id="`${kiteId}-paint1_linear`"
            x1="12.8583"
            y1="10.3858"
            x2="8.40764"
            y2="18.9846"
            gradientUnits="userSpaceOnUse"
          >
            <stop stop-color="#005DBB" />
            <stop offset="1" stop-color="#3D92E8" />
          </linearGradient>
          <linearGradient
            :id="`${kiteId}-paint2_linear`"
            x1="14.8452"
            y1="5.02774"
            x2="13.5047"
            y2="9.21911"
            gradientUnits="userSpaceOnUse"
          >
            <stop stop-color="#1B70C4" />
            <stop offset="1" stop-color="#54A4F2" />
          </linearGradient>
          <linearGradient
            :id="`${kiteId}-paint3_linear`"
            x1="4.85806"
            y1="24.2455"
            x2="18.9963"
            y2="24.2455"
            gradientUnits="userSpaceOnUse"
          >
            <stop stop-color="#4497EA" />
            <stop offset="0.254755" stop-color="#1463B2" />
            <stop offset="0.498725" stop-color="#0A437D" />
            <stop offset="0.666667" stop-color="#2476C8" />
            <stop offset="0.972542" stop-color="#0C549A" />
          </linearGradient>
        </defs>
      </svg>
      <IconEyeOff
        v-else
        aria-hidden="true"
        class="cpk-inspector-button-menu-item-icon"
      />
      <span>
        <span class="cpk-inspector-button-menu-item-label">{{
          item.label
        }}</span>
        <span class="cpk-inspector-button-menu-item-description">{{
          descriptionFor(item)
        }}</span>
      </span>
    </template>
  </CopilotDropdownMenuContent>
</template>
