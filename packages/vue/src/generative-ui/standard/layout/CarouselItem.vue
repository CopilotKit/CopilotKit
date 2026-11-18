<script setup lang="ts">
import { useCarouselSlideWidth, useLayoutContainer } from "./layout";
import type { LayoutContainerProps } from "./layout";

defineOptions({ name: "CopilotGenerativeUICarouselItem" });

/**
 * A slide of a Carousel: a column that snaps to the start edge. When the
 * Carousel sets `visibleItems`, the slide takes its share of the width.
 */
const props = defineProps<LayoutContainerProps>();

const slideWidth = useCarouselSlideWidth();
const { root, attributes } = useLayoutContainer(props, () => ({
  flex: "0 0 auto",
  flexDirection: "column",
  scrollSnapAlign: "start",
  width: slideWidth?.value,
}));
</script>

<template>
  <div ref="root" v-bind="attributes"><slot name="children" /></div>
</template>
