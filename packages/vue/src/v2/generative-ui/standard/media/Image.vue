<script setup lang="ts">
import { computed, ref } from "vue";
import type { CSSProperties } from "vue";
import type { z } from "zod";
import {
  ON_ACCENT,
  backgroundColor,
  borderColor,
  openUrl,
  radius as radiusToken,
  radiusStyle,
  spacing,
  textColor,
} from "@copilotkit/shared/generative-ui";
import type {
  IMAGE_VARIANTS,
  imageSchema,
} from "@copilotkit/shared/generative-ui";
import {
  controlAria,
  useGenerativeUIAccessibility,
  wrapperAria,
} from "../../accessibility";
import { useStandardStyles } from "../../standard-styles";
import type { GenerativeUIEventProp } from "../context";
import Lightbox from "../Lightbox.vue";
import LucideIcon from "./LucideIcon.vue";

defineOptions({ name: "CopilotGenerativeUIImage" });

type ImageProps = z.output<typeof imageSchema>;

/**
 * An image from a URL. A click opens it full-screen in a Lightbox, unless
 * `lightbox` is `false`. When the image fails to load, it shows the
 * `fallback` text, or nothing with `hideOnFailure`. An `actionOverlay` adds
 * a button over the bottom-right corner: it opens its `href`, or sends
 * `onOverlayClick`.
 */
const props = withDefaults(
  defineProps<{
    url: ImageProps["url"];
    /** What the image shows, for screen readers. Unset for decoration. */
    description?: ImageProps["description"];
    /** The size. Default "mediumFeature": the natural size. */
    variant?: ImageProps["variant"];
    weight?: ImageProps["weight"];
    aspectRatio?: ImageProps["aspectRatio"];
    /** CSS object-fit. Default "cover". */
    fit?: ImageProps["fit"];
    radius?: ImageProps["radius"];
    width?: ImageProps["width"];
    height?: ImageProps["height"];
    maxWidth?: ImageProps["maxWidth"];
    maxHeight?: ImageProps["maxHeight"];
    minWidth?: ImageProps["minWidth"];
    minHeight?: ImageProps["minHeight"];
    background?: ImageProps["background"];
    /** A thin border around the image. */
    frame?: ImageProps["frame"];
    /** CSS object-position, for example "top". */
    position?: ImageProps["position"];
    /** Renders nothing when the image fails to load. */
    hideOnFailure?: ImageProps["hideOnFailure"];
    /** The text shown in place of the image when it fails to load. */
    fallback?: ImageProps["fallback"];
    /** A slight zoom on hover. */
    hoverZoom?: ImageProps["hoverZoom"];
    /** Whether a click opens the image full-screen. Default `true`. */
    lightbox?: ImageProps["lightbox"];
    /** A button over the bottom-right corner of the image. */
    actionOverlay?: ImageProps["actionOverlay"];
    /** Sent on a click of the `actionOverlay` button when it has no `href`. */
    onOverlayClick?: GenerativeUIEventProp;
  }>(),
  { lightbox: true },
);

type ImageVariantStyle = Pick<
  CSSProperties,
  "width" | "height" | "maxWidth" | "aspectRatio" | "borderRadius"
>;

/** The size of each Image variant. "mediumFeature" is the natural size. */
const IMAGE_VARIANT_STYLE: Record<
  (typeof IMAGE_VARIANTS)[number],
  ImageVariantStyle
> = {
  icon: { width: "24px", height: "24px", borderRadius: radiusToken("xs") },
  avatar: { width: "40px", height: "40px", borderRadius: radiusToken("full") },
  smallFeature: { width: "100%", maxWidth: "160px" },
  mediumFeature: {},
  largeFeature: { width: "100%" },
  header: { width: "100%", aspectRatio: "3 / 1" },
};

const OBJECT_FIT = {
  cover: "cover",
  contain: "contain",
  fill: "fill",
  none: "none",
  scaleDown: "scale-down",
} as const;

const OVERLAY_STYLE: CSSProperties = {
  position: "absolute",
  right: "8px",
  bottom: "8px",
  display: "inline-flex",
  alignItems: "center",
  gap: "6px",
  padding: "6px 12px",
  borderRadius: "9999px",
  border: "none",
  background: "var(--a2ui-color-overlay, rgba(0,0,0,.65))",
  color: ON_ACCENT,
  font: "inherit",
  fontSize: ".8125em",
  fontWeight: 500,
  cursor: "pointer",
};

useStandardStyles();
const aria = useGenerativeUIAccessibility();
/** The src of the failed load: a new url starts unfailed. */
const failedSrc = ref<string | null>(null);
const isOpen = ref(false);
const isHovered = ref(false);

const failed = computed(() => failedSrc.value === props.url);
const alt = computed(() => props.description ?? "");
const showsLightbox = computed(() => props.lightbox && !failed.value);
const hasWrapper = computed(
  () => props.actionOverlay !== undefined || props.hoverZoom === true,
);
const mode = computed(() => {
  const isHidden = failed.value && props.hideOnFailure;
  if (!props.url || isHidden) return "hidden";
  if (failed.value && props.fallback) return "fallback";
  return hasWrapper.value ? "wrapper" : "plain";
});

const frameStyle = computed<CSSProperties>(() => {
  const variant = IMAGE_VARIANT_STYLE[props.variant ?? "mediumFeature"];
  return {
    display: "block",
    ...variant,
    aspectRatio: props.aspectRatio ?? variant.aspectRatio,
    width:
      spacing(props.width) ??
      (props.aspectRatio ? "100%" : undefined) ??
      variant.width,
    height: spacing(props.height) ?? variant.height,
    minWidth: spacing(props.minWidth),
    minHeight: spacing(props.minHeight),
    maxWidth: spacing(props.maxWidth) ?? variant.maxWidth ?? "100%",
    maxHeight: spacing(props.maxHeight),
    flexGrow: props.weight,
    boxSizing: "border-box",
    ...radiusStyle(props.radius ?? variant.borderRadius),
  };
});

const fallbackStyle = computed<CSSProperties>(() => ({
  ...frameStyle.value,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: spacing(3),
  background: backgroundColor(props.background ?? "surface-secondary"),
  color: textColor("secondary"),
  fontSize: ".875em",
  textAlign: "center",
  minHeight: spacing(props.minHeight) ?? "64px",
}));

const wrapperStyle = computed<CSSProperties>(() => ({
  position: "relative",
  display: "inline-block",
  maxWidth: "100%",
  overflow: props.hoverZoom ? "hidden" : undefined,
  ...radiusStyle(props.radius),
}));

/**
 * The attributes of the `<img>`. With an overlay button next to it, hidden
 * and live belong to the wrapper around the pair. The name stays on the
 * image, because names do not inherit.
 */
const imageAttributes = computed(() => ({
  src: props.url,
  alt: alt.value,
  ...(hasWrapper.value ? controlAria(aria.value) : aria.value),
  loading: "lazy" as const,
  "data-a2ui-lightbox-trigger": showsLightbox.value ? "" : undefined,
  style: {
    ...frameStyle.value,
    cursor: showsLightbox.value ? "zoom-in" : undefined,
    objectFit: OBJECT_FIT[props.fit ?? "cover"],
    objectPosition: props.position,
    background: backgroundColor(props.background),
    border: props.frame ? `1px solid ${borderColor("default")}` : undefined,
    transform: props.hoverZoom && isHovered.value ? "scale(1.03)" : undefined,
    transition: props.hoverZoom ? "transform .2s ease" : undefined,
  } satisfies CSSProperties,
}));

// The src of the element, not `url`: an error that arrives late belongs to
// the src that was loading.
function onError(event: Event) {
  if (event.currentTarget instanceof HTMLImageElement) {
    failedSrc.value = event.currentTarget.getAttribute("src");
  }
}

function open() {
  if (showsLightbox.value) isOpen.value = true;
}

function onOverlay(overlay: NonNullable<ImageProps["actionOverlay"]>) {
  if (overlay.href) openUrl(overlay.href);
  else void props.onOverlayClick?.({});
}
</script>

<template>
  <Lightbox
    v-if="isOpen && showsLightbox"
    :images="[{ src: url, alt }]"
    :aria="aria"
    @close="isOpen = false"
  />
  <div
    v-if="mode === 'fallback'"
    role="img"
    :aria-label="alt || fallback"
    v-bind="aria"
    :style="fallbackStyle"
  >
    {{ fallback }}
  </div>
  <div
    v-else-if="mode === 'wrapper'"
    v-bind="wrapperAria(aria)"
    :style="wrapperStyle"
    @mouseenter="isHovered = true"
    @mouseleave="isHovered = false"
  >
    <img v-bind="imageAttributes" @error="onError" @click="open" />
    <button
      v-if="actionOverlay"
      type="button"
      data-a2ui-input=""
      :style="OVERLAY_STYLE"
      @click.stop="onOverlay(actionOverlay)"
    >
      <LucideIcon
        v-if="actionOverlay.icon"
        :name="actionOverlay.icon"
        :size="14"
      />
      {{ actionOverlay.label }}
    </button>
  </div>
  <img
    v-else-if="mode === 'plain'"
    v-bind="imageAttributes"
    @error="onError"
    @click="open"
  />
</template>
