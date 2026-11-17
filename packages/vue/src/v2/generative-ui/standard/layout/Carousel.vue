<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  SHADOW_SM,
  backgroundColor,
  borderColor,
  layoutStyle,
  panelBackground,
  spacing,
  textColor,
} from "@copilotkit/shared/generative-ui";
import type {
  StyleMap,
  carouselSchema,
} from "@copilotkit/shared/generative-ui";
import type { z } from "zod";
import { useStandardStyles } from "../../standard-styles";
import { useCardNesting } from "../context";
import { useVisibleOnce } from "../visible-once";
import { provideCarouselSlideWidth, scrollAttributes } from "./layout";
import type { LayoutContainerProps } from "./layout";

defineOptions({ name: "CopilotGenerativeUICarousel" });

type CarouselProps = z.output<typeof carouselSchema>;

/**
 * A horizontal snap scroller with previous and next arrows. A Carousel
 * always scrolls, so it can always take keyboard focus. With a `label`, it
 * is a named region for screen readers. `activeIndex` is a `v-model`:
 * setting it scrolls that slide into view, and a scroll writes the index of
 * the snapped slide back. With `visibleItems`, that many slides fill its
 * width.
 */
const props = withDefaults(
  defineProps<
    LayoutContainerProps & {
      label?: CarouselProps["label"];
      visibleItems?: CarouselProps["visibleItems"];
      showArrows?: CarouselProps["showArrows"];
      previousLabel?: CarouselProps["previousLabel"];
      nextLabel?: CarouselProps["nextLabel"];
      snap?: CarouselProps["snap"];
      snapAlign?: CarouselProps["snapAlign"];
    }
  >(),
  { showArrows: undefined },
);

const activeIndex = defineModel<CarouselProps["activeIndex"]>("activeIndex");

useStandardStyles();
const nested = useCardNesting();
const scroller = ref<HTMLElement | null>(null);
useVisibleOnce(scroller, () => props.onVisible);
const canPrev = ref(false);
const canNext = ref(false);

provideCarouselSlideWidth(
  computed(() => {
    const count = Math.floor(props.visibleItems ?? 0);
    if (count < 1) return undefined;
    const gap = spacing(props.gap ?? 2);
    return `calc((100% - ${count - 1} * ${gap}) / ${count})`;
  }),
);

const WRAPPER_STYLE: StyleMap = {
  position: "relative",
  width: "100%",
  minWidth: 0,
};

const ARROW_STYLE: StyleMap = {
  position: "absolute",
  top: "50%",
  transform: "translateY(-50%)",
  width: "32px",
  height: "32px",
  borderRadius: "9999px",
  border: `1px solid ${borderColor("default")}`,
  background: backgroundColor("surface-elevated"),
  color: textColor("default"),
  boxShadow: SHADOW_SM,
  transition: "opacity .15s",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: "16px",
  lineHeight: 1,
  zIndex: 1,
};

const scrollerAttributes = computed(() => {
  const hasLabel = props.label !== undefined;
  const snap = props.snap ?? "proximity";
  const style: StyleMap = {
    ...layoutStyle(props),
    ...(nested.value && props.background
      ? { background: panelBackground(props.background) }
      : {}),
    flexDirection: "row",
    gap: spacing(props.gap ?? 2),
    overflowX: "auto",
    scrollSnapType: snap === "none" ? undefined : `x ${snap}`,
    scrollbarWidth: "none",
  };
  return {
    "data-a2ui-std": "",
    "data-a2ui-carousel": "",
    ...scrollAttributes(true),
    role: props.role ?? (hasLabel ? "region" : undefined),
    "aria-label": props.label,
    "aria-roledescription": hasLabel ? "carousel" : undefined,
    style,
  };
});

const arrows = computed(() => {
  if (props.showArrows === false) return [];
  return [
    {
      direction: -1,
      name: "prev",
      glyph: "‹",
      label: props.previousLabel ?? "Previous",
      isEnabled: canPrev.value,
      side: "left",
    },
    {
      direction: 1,
      name: "next",
      glyph: "›",
      label: props.nextLabel ?? "Next",
      isEnabled: canNext.value,
      side: "right",
    },
  ].map((arrow) => {
    const style: StyleMap = {
      ...ARROW_STYLE,
      [arrow.side]: "4px",
      cursor: arrow.isEnabled ? "pointer" : "default",
      opacity: arrow.isEnabled ? 1 : 0,
      pointerEvents: arrow.isEnabled ? "auto" : "none",
    };
    return { ...arrow, style };
  });
});

function slides() {
  const children = scroller.value?.children ?? [];
  return [...children].filter(
    (child): child is HTMLElement => child instanceof HTMLElement,
  );
}

function update() {
  const element = scroller.value;
  if (!element) return;
  canPrev.value = element.scrollLeft > 4;
  canNext.value =
    element.scrollLeft + element.clientWidth < element.scrollWidth - 4;
}

function scrollTo(index: number) {
  const element = scroller.value;
  const target = slides()[index];
  if (!element || !target) return;
  const left = target.offsetLeft - element.offsetLeft;
  // jsdom has no scrollTo on elements.
  if (typeof element.scrollTo === "function") {
    element.scrollTo({ left, behavior: "smooth" });
  } else {
    element.scrollLeft = left;
  }
}

/** The index of the slide nearest to the left edge. */
function nearest() {
  const element = scroller.value;
  if (!element) return 0;
  let best = 0;
  let bestDistance = Infinity;
  slides().forEach((slide, index) => {
    const distance = Math.abs(
      slide.offsetLeft - element.offsetLeft - element.scrollLeft,
    );
    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
  });
  return best;
}

function step(direction: number) {
  scrollTo(Math.max(0, nearest() + direction));
}

// The scroller exists only in the browser, after mount.
onMounted(() => {
  update();
  if (typeof activeIndex.value === "number") scrollTo(activeIndex.value);
});
watch(activeIndex, (index) => {
  if (typeof index === "number") scrollTo(index);
});

let timer: ReturnType<typeof setTimeout> | undefined;
function onScroll() {
  update();
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    const index = nearest();
    if (index !== activeIndex.value) activeIndex.value = index;
  }, 120);
}
onBeforeUnmount(() => {
  if (timer) clearTimeout(timer);
});
</script>

<template>
  <div :style="WRAPPER_STYLE">
    <div ref="scroller" v-bind="scrollerAttributes" @scroll="onScroll">
      <slot name="children" />
    </div>
    <button
      v-for="arrow in arrows"
      :key="arrow.name"
      type="button"
      :aria-label="arrow.label"
      :disabled="!arrow.isEnabled"
      :data-a2ui-carousel-arrow="arrow.name"
      :style="arrow.style"
      @click.stop="step(arrow.direction)"
    >
      {{ arrow.glyph }}
    </button>
  </div>
</template>
