<script setup lang="ts">
import { computed, ref } from "vue";
import type { CSSProperties } from "vue";
import type { z } from "zod";
import { openUrl, radius, spacing } from "@copilotkit/shared/generative-ui";
import type {
  gridImage,
  imageGridSchema,
} from "@copilotkit/shared/generative-ui";
import { useGenerativeUIAccessibility } from "../../accessibility";
import { useStandardStyles } from "../../standard-styles";
import Lightbox from "../Lightbox.vue";
import { SECONDARY_XS } from "./styles";

defineOptions({ name: "CopilotGenerativeUIImageGrid" });

type GridImageItem = z.output<typeof gridImage>;
type ImageGridProps = z.output<typeof imageGridSchema>;

/**
 * A gallery of images in a grid. A click opens the image full-screen in the
 * Lightbox, with arrows to the other images. An image with `href` opens
 * that URL instead. Without images it renders nothing.
 */
const props = defineProps<{
  images?: ImageGridProps["images"];
  /** Default 3. */
  columns?: ImageGridProps["columns"];
  /** The aspect ratio of each cell. Default "1 / 1". */
  aspectRatio?: ImageGridProps["aspectRatio"];
  /** Default 2. */
  gap?: ImageGridProps["gap"];
  /** Default "grid". "bento" makes the first image twice as large. */
  layout?: ImageGridProps["layout"];
}>();

useStandardStyles();
const aria = useGenerativeUIAccessibility();

/** The index of the image open in the Lightbox, or `null`. */
const openIndex = ref<number | null>(null);

const shownImages = computed(() => props.images ?? []);
const lightboxImages = computed(() =>
  shownImages.value.map((image) => ({
    src: image.url,
    alt: image.description,
  })),
);
const columnCount = computed(() => Math.max(1, Math.floor(props.columns ?? 3)));
const isBento = computed(
  () => props.layout === "bento" && shownImages.value.length > 1,
);

const style = computed<CSSProperties>(() => ({
  display: "grid",
  gridTemplateColumns: `repeat(${columnCount.value}, minmax(0, 1fr))`,
  gridAutoFlow: isBento.value ? "dense" : undefined,
  gap: spacing(props.gap ?? 2),
  width: "100%",
}));

function figureStyle(index: number): CSSProperties {
  const isLead = isBento.value && index === 0;
  return {
    margin: 0,
    minWidth: 0,
    gridColumn: isLead ? `span ${Math.min(2, columnCount.value)}` : undefined,
    gridRow: isLead ? "span 2" : undefined,
    display: "flex",
    flexDirection: "column",
    gap: "4px",
  };
}

function imageStyle(image: GridImageItem, index: number): CSSProperties {
  const isLead = isBento.value && index === 0;
  return {
    display: "block",
    width: "100%",
    height: "100%",
    aspectRatio: isLead ? undefined : (props.aspectRatio ?? "1 / 1"),
    objectFit: "cover",
    borderRadius: radius("md"),
    cursor: image.href ? "pointer" : "zoom-in",
  };
}

function onImageClick(image: GridImageItem, index: number) {
  if (image.href) {
    openUrl(image.href);
    return;
  }
  openIndex.value = index;
}
</script>

<template>
  <div
    v-if="shownImages.length > 0"
    data-a2ui-image-grid=""
    data-a2ui-std=""
    :style="style"
  >
    <figure
      v-for="(image, index) in shownImages"
      :key="`${image.url}-${index}`"
      :style="figureStyle(index)"
    >
      <img
        :src="image.url"
        :alt="image.description ?? ''"
        loading="lazy"
        :style="imageStyle(image, index)"
        @click="onImageClick(image, index)"
      />
      <figcaption v-if="image.caption" :style="SECONDARY_XS">
        {{ image.caption }}
      </figcaption>
    </figure>
    <!-- Teleported to body, so it adds no cell to the grid. -->
    <Lightbox
      v-if="openIndex !== null"
      :images="lightboxImages"
      :index="openIndex"
      :aria="aria"
      @close="openIndex = null"
    />
  </div>
</template>
