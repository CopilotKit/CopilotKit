<script setup lang="ts">
/**
 * React's `<Tooltip>` (Radix) for Vue: a label that shows next to its trigger
 * on hover and on keyboard focus, and hides on pointer leave, blur, a click,
 * Escape, or a scroll that moves the trigger. The default slot renders the
 * trigger and must bind `triggerProps` on a focusable element.
 *
 * @internal
 */
import { computed, onBeforeUnmount, ref, watch } from "vue";
import type { FloatingAlign, FloatingSide } from "./floating";
import { arrowWrapperStyle, useFloating } from "./floating";
import { usePresence } from "./presence";
import { useCopilotId } from "./use-id";

const props = withDefaults(
  defineProps<{
    /** Text of the tooltip; the `content` slot replaces it. */
    content?: string;
    side?: FloatingSide;
    align?: FloatingAlign;
    sideOffset?: number;
    /** Hover time before it opens, in ms. Focus opens it at once. */
    delayDuration?: number;
    /** Keeps it closed, for example while the trigger's own popup shows. */
    suppressed?: boolean;
    contentClass?: string;
  }>(),
  {
    content: undefined,
    side: "top",
    align: "center",
    sideOffset: 0,
    delayDuration: 0,
    suppressed: false,
    contentClass: undefined,
  },
);

defineSlots<{
  default(props: {
    triggerProps: Record<string, unknown>;
    open: boolean;
  }): unknown;
  content?(): unknown;
}>();

// Matches `.cpk-tooltip-arrow` (0.625rem); Radix adds it to the offset.
const ARROW_SIZE = 10;
// Time the pointer has to cross from the trigger onto the tooltip.
const HOVER_GRACE_MS = 100;

const id = useCopilotId("cpk-tooltip");
const wantsOpen = ref(false);
const open = computed(() => wantsOpen.value && !props.suppressed);
const trigger = ref<HTMLElement | null>(null);
const wrapper = ref<HTMLElement | null>(null);
const contentElement = ref<HTMLElement | null>(null);
const present = usePresence(open, contentElement);

const { placement, wrapperStyle } = useFloating(trigger, wrapper, open, () => ({
  side: props.side,
  align: props.align,
  sideOffset: props.sideOffset,
  arrowSize: ARROW_SIZE,
}));

let openTimer: ReturnType<typeof setTimeout> | undefined;
let closeTimer: ReturnType<typeof setTimeout> | undefined;
let pointerDown = false;
// Set once the pointer has opened it, until the pointer leaves: after a click
// closes it, moving over the trigger again does not reopen it.
let pointerMoveOpened = false;

const clearTimers = () => {
  clearTimeout(openTimer);
  clearTimeout(closeTimer);
  openTimer = undefined;
  closeTimer = undefined;
};

const show = () => {
  clearTimers();
  if (!props.suppressed) wantsOpen.value = true;
};

const hide = () => {
  clearTimers();
  wantsOpen.value = false;
};

// A request to open while suppressed is dropped, so the tooltip does not
// reappear when the suppression ends under a pointer that already left.
watch(
  () => props.suppressed,
  (suppressed) => {
    if (suppressed) hide();
  },
);

const onPointerMove = (event: PointerEvent) => {
  if (event.pointerType === "touch") return;
  trigger.value = event.currentTarget as HTMLElement;
  clearTimeout(closeTimer);
  closeTimer = undefined;
  if (pointerMoveOpened || pointerDown) return;
  pointerMoveOpened = true;
  if (props.delayDuration > 0) {
    openTimer = setTimeout(show, props.delayDuration);
  } else {
    show();
  }
};

const scheduleClose = () => {
  clearTimeout(openTimer);
  openTimer = undefined;
  clearTimeout(closeTimer);
  closeTimer = setTimeout(hide, HOVER_GRACE_MS);
};

const onPointerLeave = (event: PointerEvent) => {
  if (event.pointerType === "touch") return;
  pointerMoveOpened = false;
  const next = event.relatedTarget;
  if (next instanceof Node && contentElement.value?.contains(next)) return;
  scheduleClose();
};

const onPointerUp = () => {
  pointerDown = false;
};

const onPointerDown = () => {
  pointerDown = true;
  document.addEventListener("pointerup", onPointerUp, { once: true });
  hide();
};

const onFocus = (event: FocusEvent) => {
  trigger.value = event.currentTarget as HTMLElement;
  if (!pointerDown) show();
};

const triggerProps = computed(() => ({
  "data-state": open.value ? "delayed-open" : "closed",
  "aria-describedby": open.value ? id : undefined,
  onPointermove: onPointerMove,
  onPointerleave: onPointerLeave,
  onPointerdown: onPointerDown,
  onFocus,
  onBlur: hide,
  onClick: hide,
}));

const onKeyDown = (event: KeyboardEvent) => {
  if (event.key === "Escape") hide();
};

const onScroll = (event: Event) => {
  const target = event.target;
  if (target instanceof Node && target.contains(trigger.value)) hide();
};

watch(
  open,
  (isOpen) => {
    if (typeof document === "undefined") return;
    if (isOpen) {
      document.addEventListener("keydown", onKeyDown);
      window.addEventListener("scroll", onScroll, { capture: true });
    } else {
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", onScroll, { capture: true });
    }
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  clearTimers();
  if (typeof document === "undefined") return;
  document.removeEventListener("keydown", onKeyDown);
  document.removeEventListener("pointerup", onPointerUp);
  window.removeEventListener("scroll", onScroll, { capture: true });
});

const contentStyle = computed(() => ({
  "--radix-tooltip-content-transform-origin":
    placement.value?.transformOrigin ?? "center",
}));
</script>

<template>
  <slot :trigger-props="triggerProps" :open="open" />
  <Teleport to="body">
    <div
      v-if="present"
      ref="wrapper"
      data-radix-popper-content-wrapper
      :style="wrapperStyle()"
    >
      <div
        :id="id"
        ref="contentElement"
        data-copilotkit
        data-slot="tooltip-content"
        role="tooltip"
        class="cpk-tooltip"
        :class="contentClass"
        :data-state="open ? 'delayed-open' : 'closed'"
        :data-side="placement?.side ?? side"
        :data-align="placement?.align ?? align"
        :style="contentStyle"
        @pointerenter="clearTimers"
        @pointerleave="scheduleClose"
      >
        <slot name="content">
          <p>{{ content }}</p>
        </slot>
        <span :style="arrowWrapperStyle(placement)">
          <svg
            class="cpk-tooltip-arrow"
            width="10"
            height="5"
            viewBox="0 0 30 10"
            preserveAspectRatio="none"
            aria-hidden="true"
            style="display: block"
          >
            <polygon points="0,0 30,0 15,10" />
          </svg>
        </span>
      </div>
    </div>
  </Teleport>
</template>
