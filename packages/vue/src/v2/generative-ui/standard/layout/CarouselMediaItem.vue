<script setup lang="ts">
import { computed, ref, shallowRef } from "vue";
import {
  layoutStyle,
  openUrl,
  radius,
  spacing,
} from "@copilotkit/shared/generative-ui";
import type {
  CAROUSEL_MEDIA_SIZES,
  StyleMap,
  carouselMediaItemSchema,
} from "@copilotkit/shared/generative-ui";
import type { z } from "zod";
import { useGenerativeUIAccessibility } from "../../accessibility";
import { useStandardStyles } from "../../standard-styles";
import Lightbox from "../Lightbox.vue";
import type { LightboxImage } from "../Lightbox.vue";
import type { GenerativeUIEventProp } from "../context";
import { useVisibleOnce } from "../visible-once";
import type { LayoutContainerProps } from "./layout";

defineOptions({ name: "CopilotGenerativeUICarouselMediaItem" });

type CarouselMediaItemProps = z.output<typeof carouselMediaItemSchema>;

/**
 * A slide with an image on top and its children under it. A click on the
 * image opens a lightbox over every media slide of the same carousel, with
 * the clicked one selected. `href` or a bound `onClick` take over the click
 * instead.
 */
const props = withDefaults(
  defineProps<
    LayoutContainerProps & {
      url: CarouselMediaItemProps["url"];
      description?: CarouselMediaItemProps["description"];
      size?: CarouselMediaItemProps["size"];
      href?: CarouselMediaItemProps["href"];
      lightbox?: CarouselMediaItemProps["lightbox"];
      /** Sent when the user clicks the image, instead of the lightbox. */
      onClick?: GenerativeUIEventProp;
    }
  >(),
  { lightbox: undefined },
);

/** The width of a CarouselMediaItem by size. */
const MEDIA_WIDTH: Record<(typeof CAROUSEL_MEDIA_SIZES)[number], string> = {
  sm: "160px",
  md: "240px",
  lg: "320px",
};

useStandardStyles();
const aria = useGenerativeUIAccessibility();
const root = ref<HTMLElement | null>(null);
useVisibleOnce(root, () => props.onVisible);
const open = shallowRef<{ images: LightboxImage[]; index: number } | null>(
  null,
);

const hasHref = computed(
  () => typeof props.href === "string" && props.href !== "",
);
const hasAction = computed(() => props.onClick !== undefined);
const showsLightbox = computed(
  () => props.lightbox !== false && !hasHref.value && !hasAction.value,
);
const isClickable = computed(
  () => showsLightbox.value || hasHref.value || hasAction.value,
);

const rootStyle = computed(() => {
  const style: StyleMap = {
    ...layoutStyle(props),
    flex: "0 0 auto",
    flexDirection: "column",
    scrollSnapAlign: "start",
    width: MEDIA_WIDTH[props.size ?? "md"],
    gap: spacing(props.gap ?? 2),
  };
  return style;
});

const imageStyle = computed(() => {
  const clickCursor = isClickable.value ? "pointer" : undefined;
  const style: StyleMap = {
    display: "block",
    width: "100%",
    aspectRatio: props.aspectRatio ?? "4 / 3",
    objectFit: "cover",
    borderRadius: radius("lg"),
    cursor: showsLightbox.value ? "zoom-in" : clickCursor,
  };
  return style;
});

function onImageClick(event: MouseEvent) {
  if (!isClickable.value) return;
  event.stopPropagation();
  if (hasHref.value) {
    openUrl(props.href);
    return;
  }
  if (props.onClick) {
    void props.onClick({});
    return;
  }
  const own = event.currentTarget;
  if (!showsLightbox.value || !(own instanceof HTMLImageElement)) return;
  const scope =
    own.closest("[data-a2ui-carousel]") ?? own.parentElement?.parentElement;
  const slides = [
    ...(scope?.querySelectorAll<HTMLImageElement>(
      "[data-a2ui-carousel-media] > img",
    ) ?? []),
  ];
  const images = slides.map((img) => ({ src: img.src, alt: img.alt }));
  const index = Math.max(
    0,
    slides.findIndex((img) => img === own),
  );
  open.value =
    images.length > 0
      ? { images, index }
      : { images: [{ src: props.url, alt: props.description }], index: 0 };
}
</script>

<template>
  <div
    ref="root"
    data-a2ui-std=""
    data-a2ui-carousel-media=""
    :role="props.role"
    :style="rootStyle"
  >
    <img
      :src="props.url"
      :alt="props.description ?? ''"
      loading="lazy"
      :data-a2ui-lightbox-trigger="showsLightbox ? '' : undefined"
      :style="imageStyle"
      @click="onImageClick"
    />
    <slot name="children" />
    <Lightbox
      v-if="open"
      :images="open.images"
      :index="open.index"
      :aria="aria"
      @close="open = null"
    />
  </div>
</template>
