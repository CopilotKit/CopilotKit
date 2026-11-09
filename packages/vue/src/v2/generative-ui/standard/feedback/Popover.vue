<script setup lang="ts">
import {
  computed,
  onBeforeUnmount,
  shallowRef,
  useId,
  useTemplateRef,
  watch,
} from "vue";
import type { CSSProperties, VNode } from "vue";
import type { z } from "zod";
import type { popoverSchema } from "@copilotkit/shared/generative-ui";
import { providePopover } from "./popover-context";
import { useFeedbackStyles } from "./styles";

defineOptions({ name: "CopilotGenerativeUIPopover" });

type PopoverProps = z.output<typeof popoverSchema>;

/**
 * A non-modal overlay with two children: a PopoverTrigger, then a
 * PopoverContent. A click on the trigger toggles it. It does not trap
 * focus. Escape closes it and moves focus back to the trigger. A pointer
 * press outside of it closes it. The content sits in the flow of the
 * surface, positioned against this root.
 *
 * `open` is writable (`v-model:open`), so a `{ "@path" }` binding keeps the
 * open state in the data model.
 */
const props = defineProps<{
  showOnHover?: PopoverProps["showOnHover"];
  hoverOpenDelay?: PopoverProps["hoverOpenDelay"];
}>();

const open = defineModel<PopoverProps["open"]>("open");

defineSlots<{ children?: () => VNode[] }>();

useFeedbackStyles();

const id = useId();
const isOpen = computed(() => open.value ?? false);
const setOpen = (value: boolean) => {
  open.value = value;
};
const triggerElement = shallowRef<HTMLElement | null>(null);

providePopover({
  isOpen,
  setOpen,
  triggerId: `${id}-trigger`,
  contentId: `${id}-content`,
  triggerElement,
});

const root = useTemplateRef<HTMLDivElement>("root");
const ROOT_STYLE: CSSProperties = {
  position: "relative",
  display: "inline-flex",
};

let hoverTimer: ReturnType<typeof setTimeout> | undefined;
const clearHoverTimer = () => {
  clearTimeout(hoverTimer);
  hoverTimer = undefined;
};
// A pending hover open must not fire after the Popover is gone.
onBeforeUnmount(clearHoverTimer);

function onMouseEnter() {
  if (!props.showOnHover) return;
  clearHoverTimer();
  const delay = props.hoverOpenDelay ?? 0;
  if (delay <= 0) {
    setOpen(true);
    return;
  }
  // Hover opening may be turned off while the timer runs.
  hoverTimer = setTimeout(() => {
    if (props.showOnHover) setOpen(true);
  }, delay);
}

function onMouseLeave() {
  if (!props.showOnHover) return;
  clearHoverTimer();
  setOpen(false);
}

// While open, a pointer press outside of the Popover closes it.
watch(
  isOpen,
  (value, _previous, onCleanup) => {
    if (!value || typeof document === "undefined") return;
    const onPointerDown = (event: PointerEvent) => {
      const element = root.value;
      const isOutside =
        element !== null &&
        event.target instanceof Node &&
        !element.contains(event.target);
      if (isOutside) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    onCleanup(() => document.removeEventListener("pointerdown", onPointerDown));
  },
  { immediate: true },
);

function onKeyDown(event: KeyboardEvent) {
  if (event.key !== "Escape" || !isOpen.value) return;
  // Escape closes only the topmost overlay.
  event.stopPropagation();
  setOpen(false);
  triggerElement.value?.focus();
}
</script>

<template>
  <div
    ref="root"
    data-a2ui-std=""
    :style="ROOT_STYLE"
    @keydown="onKeyDown"
    @mouseenter="onMouseEnter"
    @mouseleave="onMouseLeave"
  >
    <slot name="children" />
  </div>
</template>
