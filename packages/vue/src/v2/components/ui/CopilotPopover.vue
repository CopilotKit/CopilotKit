<script setup lang="ts">
/**
 * React's `<PopoverContent>` (Radix, non-modal) for Vue: content in a portal
 * next to an anchor element, so it floats over the page instead of taking
 * room in the layout. Escape, a pointer down outside, and focus moving
 * outside dismiss it, unless the handler of `escape-key-down` or
 * `interact-outside` calls `preventDefault()`. It does not move focus by
 * itself; the parent decides where focus goes.
 *
 * @internal
 */
import { computed, onBeforeUnmount, ref, toRef, watch } from "vue";
import type { FloatingAlign, FloatingSide } from "./floating";
import { useFloating } from "./floating";
import { usePresence } from "./presence";
import { useCopilotId } from "./use-id";

defineOptions({ inheritAttrs: false });

const props = withDefaults(
  defineProps<{
    open: boolean;
    /** The element the content points at. */
    anchor: HTMLElement | null;
    side?: FloatingSide;
    align?: FloatingAlign;
    sideOffset?: number;
    collisionPadding?: number;
    /** Hides the content while its anchor is scrolled out of view. */
    hideWhenDetached?: boolean;
  }>(),
  {
    side: "bottom",
    align: "start",
    sideOffset: 6,
    collisionPadding: 0,
    hideWhenDetached: false,
  },
);

const emit = defineEmits<{
  /** Escape was pressed while it was open. */
  "escape-key-down": [event: KeyboardEvent];
  /** A pointer down or focus outside it. */
  "interact-outside": [event: Event];
  /** It should close: the events above were not prevented. */
  dismiss: [];
}>();

defineSlots<{ default(): unknown }>();

const id = useCopilotId("cpk-popover");
const wrapper = ref<HTMLElement | null>(null);
const content = ref<HTMLElement | null>(null);
const open = toRef(props, "open");
const anchor = toRef(props, "anchor");
const present = usePresence(open, content);

const { placement, wrapperStyle } = useFloating(anchor, wrapper, open, () => ({
  side: props.side,
  align: props.align,
  sideOffset: props.sideOffset,
  collisionPadding: props.collisionPadding,
  hideWhenDetached: props.hideWhenDetached,
}));

const isInside = (target: EventTarget | null) =>
  target instanceof Node && !!content.value?.contains(target);

const onKeyDown = (event: KeyboardEvent) => {
  if (event.key !== "Escape") return;
  emit("escape-key-down", event);
  if (!event.defaultPrevented) emit("dismiss");
};

const onOutside = (event: Event) => {
  if (isInside(event.target)) return;
  emit("interact-outside", event);
  if (!event.defaultPrevented) emit("dismiss");
};

const listen = (on: boolean) => {
  if (typeof document === "undefined") return;
  // Capture, as Radix does, so a handler can stop Escape from also reaching
  // a chat popup's own Escape listener.
  if (on) {
    document.addEventListener("keydown", onKeyDown, { capture: true });
    document.addEventListener("pointerdown", onOutside, { capture: true });
    document.addEventListener("focusin", onOutside, { capture: true });
  } else {
    document.removeEventListener("keydown", onKeyDown, { capture: true });
    document.removeEventListener("pointerdown", onOutside, { capture: true });
    document.removeEventListener("focusin", onOutside, { capture: true });
  }
};

watch(open, (isOpen) => listen(isOpen), { immediate: true });
onBeforeUnmount(() => listen(false));

const contentStyle = computed(() => ({
  "--radix-popover-content-transform-origin":
    placement.value?.transformOrigin ?? "center",
  "--radix-popover-content-available-height": placement.value
    ? `${placement.value.availableHeight}px`
    : undefined,
}));

defineExpose({ content });
</script>

<template>
  <Teleport to="body">
    <div
      v-if="present"
      ref="wrapper"
      data-radix-popper-content-wrapper
      :style="wrapperStyle()"
    >
      <div
        :id="id"
        ref="content"
        role="dialog"
        tabindex="-1"
        data-copilotkit
        data-copilotkit-popover
        data-slot="popover-content"
        class="cpk-popover"
        :data-state="open ? 'open' : 'closed'"
        :data-side="placement?.side ?? side"
        :data-align="placement?.align ?? align"
        :style="contentStyle"
        v-bind="$attrs"
      >
        <slot />
      </div>
    </div>
  </Teleport>
</template>
