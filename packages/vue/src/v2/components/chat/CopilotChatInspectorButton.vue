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
import {
  ɵHoverMenuController,
  ɵinspectorKiteFill,
  ɵinspectorKiteIcon,
} from "@copilotkit/core";

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
const initialFocus = ref<"first" | "none">("none");
const menu = new ɵHoverMenuController();
const menuState = shallowRef(menu.getSnapshot());
const unsubscribeMenu = menu.subscribe(() => {
  menuState.value = menu.getSnapshot();
});
onBeforeUnmount(() => {
  unsubscribeMenu();
  menu.dispose();
});
const open = computed(() => menuState.value.open);
const dark = computed(() => menuState.value.dark);
const { cancelClose, scheduleClose, keyboardUsed } = menu;
const changeOpen = (next: boolean) => menu.setOpen(next, trigger.value);

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
  initialFocus.value = "none";
  menu.pointerEnter({ pointerType: event.pointerType, trigger: trigger.value });
}

function onClick() {
  changeOpen(false);
  emit("click");
}

function onKeyDown(event: KeyboardEvent) {
  keyboardUsed();
  if (event.key === "Enter" || event.key === " ") {
    // Enter and Space inspect, as a click does, instead of opening the menu.
    event.preventDefault();
    onClick();
  } else if (event.key === "ArrowDown") {
    event.preventDefault();
    initialFocus.value = "first";
    if (open.value) {
      // Open already from hover: move into it.
      changeOpen(false);
      queueMicrotask(() => changeOpen(true));
    } else {
      changeOpen(true);
    }
  }
}

function onSelect(item: CopilotDropdownMenuItem) {
  const returnFocus = !menu.openedByHover;
  changeOpen(false);
  item.action?.();
  if (returnFocus && !isInspectItem(item)) trigger.value?.focus();
}

function onDismiss(reason: CopilotDropdownMenuDismissReason) {
  const returnFocus = !menu.openedByHover && reason !== "outside";
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
    @keydown="keyboardUsed"
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
        :viewBox="ɵinspectorKiteIcon.viewBox"
        fill="none"
      >
        <path
          v-for="path in ɵinspectorKiteIcon.paths"
          :key="path.d"
          :d="path.d"
          :fill="ɵinspectorKiteFill(kiteId, path)"
          :stroke="path.stroke"
          :stroke-width="path.strokeWidth"
          :stroke-linecap="path.strokeLinecap"
        />
        <defs>
          <linearGradient
            v-for="gradient in ɵinspectorKiteIcon.gradients"
            :id="`${kiteId}-${gradient.id}`"
            :key="gradient.id"
            :x1="gradient.x1"
            :y1="gradient.y1"
            :x2="gradient.x2"
            :y2="gradient.y2"
            gradientUnits="userSpaceOnUse"
          >
            <stop
              v-for="stop in gradient.stops"
              :key="`${stop.offset ?? '0'}-${stop.color}`"
              :offset="stop.offset"
              :stop-color="stop.color"
            />
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
