<script lang="ts">
/** One image of a Lightbox. */
export interface LightboxImage {
  src: string;
  alt?: string;
}
</script>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { CSSProperties } from "vue";
import { wrapperAria } from "@copilotkit/core/generative-ui";
import type { GenerativeUIAriaAttributes } from "@copilotkit/core/generative-ui";
import {
  BACKDROP,
  ON_ACCENT,
  SHADOW_MD,
  radius,
} from "@copilotkit/shared/generative-ui";
import { useOverlayEscape } from "./overlay-stack";

defineOptions({ name: "CopilotGenerativeUILightbox" });

/**
 * A full-screen view of one or more images. A click, Escape or the close
 * button closes it. With several images, the arrows and the arrow keys move
 * between them. Image, ImageGrid and CarouselMediaItem open it with `v-if`,
 * so it closes when the component that opened it unmounts.
 *
 * It is teleported to `body`, outside the wrapper that the engine puts
 * around the component. So it takes the envelope of that component as
 * `aria`: the hidden state and the live region apply here too.
 *
 * On open, the focus moves to the close button. On close, it returns to the
 * element that had it before.
 */
const props = withDefaults(
  defineProps<{
    images: LightboxImage[];
    /** The image to show first. */
    index?: number;
    /** The ARIA attributes of the component that opens it. */
    aria?: GenerativeUIAriaAttributes;
  }>(),
  { index: 0, aria: () => ({}) },
);

const emit = defineEmits<{ close: [] }>();

const BUTTON: CSSProperties = {
  position: "absolute",
  border: "none",
  borderRadius: "9999px",
  background: "rgba(255,255,255,.15)",
  color: ON_ACCENT,
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

const ARROWS = [
  {
    delta: -1,
    label: "Previous image",
    name: "prev",
    glyph: "‹",
    side: "left",
  },
  { delta: 1, label: "Next image", name: "next", glyph: "›", side: "right" },
] as const;

const DIALOG_STYLE: CSSProperties = {
  position: "fixed",
  inset: "0",
  zIndex: 1000,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "24px",
  background: BACKDROP,
  cursor: "zoom-out",
};

const IMAGE_STYLE: CSSProperties = {
  maxWidth: "min(92vw, 1400px)",
  maxHeight: "92vh",
  objectFit: "contain",
  borderRadius: radius("md"),
  boxShadow: SHADOW_MD,
};

const COUNTER_STYLE: CSSProperties = {
  position: "absolute",
  bottom: "16px",
  left: "50%",
  transform: "translateX(-50%)",
  color: ON_ACCENT,
  fontSize: "13px",
  opacity: 0.8,
};

const CLOSE_STYLE: CSSProperties = {
  ...BUTTON,
  top: "16px",
  right: "16px",
  width: "36px",
  height: "36px",
  fontSize: "20px",
  lineHeight: 1,
};

function arrowStyle(side: "left" | "right"): CSSProperties {
  return {
    ...BUTTON,
    top: "50%",
    [side]: "16px",
    transform: "translateY(-50%)",
    width: "44px",
    height: "44px",
    fontSize: "28px",
    lineHeight: 1,
  };
}

const current = ref(props.index);
watch(
  () => props.index,
  (index) => (current.value = index),
);
const count = computed(() => props.images.length);
const image = computed(
  () => props.images[Math.min(current.value, count.value - 1)],
);
const wrapper = computed(() => wrapperAria(props.aria));

function step(delta: number) {
  const total = count.value;
  current.value = total === 0 ? 0 : (current.value + delta + total) % total;
}

const close = () => emit("close");
// Escape goes through the overlay stack, so a lightbox inside a Modal
// closes alone.
useOverlayEscape(true, close);

function onKeyDown(event: KeyboardEvent) {
  if (count.value < 2) return;
  if (event.key === "ArrowRight") step(1);
  else if (event.key === "ArrowLeft") step(-1);
}

const closeButton = ref<HTMLButtonElement | null>(null);
let previousFocus: Element | null = null;

onMounted(() => {
  previousFocus = document.activeElement;
  closeButton.value?.focus();
  document.addEventListener("keydown", onKeyDown);
});

onBeforeUnmount(() => {
  document.removeEventListener("keydown", onKeyDown);
  if (previousFocus instanceof HTMLElement) previousFocus.focus();
});
</script>

<template>
  <Teleport to="body">
    <div
      v-if="image"
      role="dialog"
      aria-modal="true"
      :aria-label="image.alt || 'Image'"
      v-bind="wrapper"
      data-a2ui-lightbox=""
      :style="DIALOG_STYLE"
      @click="close"
    >
      <img
        :key="image.src"
        :src="image.src"
        :alt="image.alt ?? ''"
        :style="IMAGE_STYLE"
      />
      <template v-if="count > 1">
        <span data-a2ui-lightbox-counter="" :style="COUNTER_STYLE"
          >{{ current + 1 }} / {{ count }}</span
        >
        <button
          v-for="arrow in ARROWS"
          :key="arrow.name"
          type="button"
          :aria-label="arrow.label"
          :data-a2ui-lightbox-arrow="arrow.name"
          :style="arrowStyle(arrow.side)"
          @click.stop="step(arrow.delta)"
        >
          {{ arrow.glyph }}
        </button>
      </template>
      <button
        ref="closeButton"
        type="button"
        aria-label="Close"
        :style="CLOSE_STYLE"
        @click.stop="close"
      >
        ×
      </button>
    </div>
  </Teleport>
</template>
