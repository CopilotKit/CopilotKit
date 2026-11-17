<script setup lang="ts">
import { computed } from "vue";
import type { CSSProperties } from "vue";
import type { z } from "zod";
import {
  ACCENT,
  FONT_WEIGHT,
  ON_ACCENT,
  backgroundColor,
  borderColor,
  lineClamp,
  openUrl,
  radius,
  safeHref,
  spacing,
  textColor,
  textFont,
} from "@copilotkit/shared/generative-ui";
import type {
  cardAction,
  entityActionArgs,
  entityCardSchema,
} from "@copilotkit/shared/generative-ui";
import { useStandardStyles } from "../../standard-styles";
import type { GenerativeUIEventProp } from "../context";
import { PILL_BUTTON, SECONDARY_SM, SECONDARY_XS, TITLE_MD } from "./styles";

defineOptions({ name: "CopilotGenerativeUIEntityCard" });

type EntityCardProps = z.output<typeof entityCardSchema>;
type CardActionItem = z.output<typeof cardAction>;

/**
 * A card for one product, place, person or listing: an image, title,
 * subtitle, description, meta line, badge, star rating and up to three
 * buttons. With `href` or a bound `onClick`, the card is a link: a click,
 * Enter or Space opens `href`, or sends `onClick` when it is bound.
 */
const props = defineProps<{
  title: EntityCardProps["title"];
  /** A second line, for example the brand or category. */
  subtitle?: EntityCardProps["subtitle"];
  /** Up to three lines. */
  description?: EntityCardProps["description"];
  image?: EntityCardProps["image"];
  /** Default "4 / 3". A horizontal card shows a square image. */
  imageAspectRatio?: EntityCardProps["imageAspectRatio"];
  /** A short fact line, for example a price. */
  meta?: EntityCardProps["meta"];
  badge?: EntityCardProps["badge"];
  /** 0 to 5, shown as stars. */
  rating?: EntityCardProps["rating"];
  ratingCount?: EntityCardProps["ratingCount"];
  /** Opens this URL in a new tab when the user clicks the card. */
  href?: EntityCardProps["href"];
  /** Up to three buttons. Only the first three show. */
  actions?: EntityCardProps["actions"];
  /** Default "vertical". "horizontal" puts the image on the left. */
  layout?: EntityCardProps["layout"];
  width?: EntityCardProps["width"];
  /** Sent when the user clicks the card. Wins over `href`. */
  onClick?: GenerativeUIEventProp;
  /** Sent when the user clicks a button without href, with its label. */
  onAction?: GenerativeUIEventProp<z.input<typeof entityActionArgs>>;
}>();

useStandardStyles();

const isHorizontal = computed(() => props.layout === "horizontal");
const safeUrl = computed(() => (props.href ? safeHref(props.href) : undefined));
const isClickable = computed(
  () => safeUrl.value !== undefined || props.onClick !== undefined,
);
const shownActions = computed(() => (props.actions ?? []).slice(0, 3));
const stars = computed(() => {
  const clamped = Math.max(0, Math.min(5, props.rating ?? 0));
  const filled = Math.round(clamped);
  return {
    clamped,
    filled: "★".repeat(filled),
    empty: "★".repeat(5 - filled),
  };
});

function activate(event: Event) {
  if (!isClickable.value) return;
  event.stopPropagation();
  if (props.onClick) void props.onClick({});
  else openUrl(safeUrl.value);
}

function onKeyDown(event: KeyboardEvent) {
  const isOwnKey = event.target === event.currentTarget;
  const isActivationKey = event.key === "Enter" || event.key === " ";
  if (!isClickable.value || !isOwnKey || !isActivationKey) return;
  event.preventDefault();
  activate(event);
}

function onActionClick(item: CardActionItem) {
  if (item.href) openUrl(item.href);
  else void props.onAction?.({ label: item.label });
}

const style = computed<CSSProperties>(() => ({
  display: "flex",
  flexDirection: isHorizontal.value ? "row" : "column",
  gap: isHorizontal.value ? spacing(3) : 0,
  width: spacing(props.width) ?? "100%",
  maxWidth: "100%",
  minWidth: 0,
  boxSizing: "border-box",
  border: `1px solid ${borderColor("default")}`,
  borderRadius: radius("xl"),
  background: backgroundColor("surface"),
  overflow: "hidden",
  // A horizontal card keeps its content height inside a stretched grid
  // row. The vertical card may fill the row.
  alignSelf: isHorizontal.value ? "start" : undefined,
  cursor: isClickable.value ? "pointer" : undefined,
}));
const imageStyle = computed<CSSProperties>(() => ({
  display: "block",
  objectFit: "cover",
  width: isHorizontal.value ? "120px" : "100%",
  aspectRatio: isHorizontal.value
    ? "1 / 1"
    : (props.imageAspectRatio ?? "4 / 3"),
  alignSelf: isHorizontal.value ? "start" : undefined,
  flex: "none",
}));
const badgeStyle = computed<CSSProperties>(() => {
  const color = props.badge?.color;
  return {
    ...textFont("xs"),
    fontWeight: FONT_WEIGHT.medium,
    padding: "1px 8px",
    borderRadius: "9999px",
    background: backgroundColor(color ?? "surface-secondary"),
    color: textColor(color ?? "default"),
    flex: "none",
  };
});

function actionStyle(item: CardActionItem): CSSProperties {
  const variant =
    item.variant ?? (item.href || props.onAction ? "outline" : "ghost");
  const isSolid = variant === "solid";
  const softOrNone =
    variant === "soft" ? backgroundColor("surface-secondary") : "transparent";
  return {
    ...PILL_BUTTON,
    border:
      variant === "outline"
        ? `1px solid ${borderColor("default")}`
        : "1px solid transparent",
    background: isSolid ? ACCENT : softOrNone,
    color: isSolid ? ON_ACCENT : textColor("default"),
  };
}

const BODY_STYLE: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "4px",
  padding: spacing(3),
  minWidth: 0,
  flex: 1,
};
const HEADER_STYLE: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "8px",
  minWidth: 0,
};
const SUBTITLE_STYLE: CSSProperties = {
  ...SECONDARY_XS,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};
const STARS_STYLE: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "4px",
  ...SECONDARY_SM,
};
const FILLED_STARS_STYLE: CSSProperties = {
  color: "var(--a2ui-color-rating, #f5a524)",
  letterSpacing: "1px",
};
const EMPTY_STARS_STYLE: CSSProperties = { color: borderColor("strong") };
const DESCRIPTION_STYLE: CSSProperties = { ...SECONDARY_SM, ...lineClamp(3) };
const META_STYLE: CSSProperties = {
  ...textFont("sm"),
  fontWeight: FONT_WEIGHT.medium,
  color: textColor("default"),
  marginTop: "2px",
};
const ACTIONS_STYLE: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: spacing(2),
  marginTop: spacing(2),
};
</script>

<template>
  <div
    data-a2ui-entity-card=""
    data-a2ui-std=""
    :role="isClickable ? 'link' : undefined"
    :tabindex="isClickable ? 0 : undefined"
    :style="style"
    @click="activate"
    @keydown="onKeyDown"
  >
    <img
      v-if="image"
      :src="image"
      :alt="title"
      loading="lazy"
      :style="imageStyle"
    />
    <div :style="BODY_STYLE">
      <div v-if="badge?.label || subtitle" :style="HEADER_STYLE">
        <span v-if="subtitle" :style="SUBTITLE_STYLE">{{ subtitle }}</span>
        <span v-if="badge?.label" :style="badgeStyle">{{ badge.label }}</span>
      </div>
      <span :style="TITLE_MD">{{ title }}</span>
      <span
        v-if="rating !== undefined"
        :aria-label="`${stars.clamped} out of 5`"
        :style="STARS_STYLE"
      >
        <span aria-hidden="true" :style="FILLED_STARS_STYLE"
          >{{ stars.filled
          }}<span :style="EMPTY_STARS_STYLE">{{ stars.empty }}</span></span
        >
        <span>{{ stars.clamped.toFixed(1) }}</span>
        <span v-if="ratingCount !== undefined">({{ ratingCount }})</span>
      </span>
      <span v-if="description" :style="DESCRIPTION_STYLE">{{
        description
      }}</span>
      <span v-if="meta" :style="META_STYLE">{{ meta }}</span>
      <div v-if="shownActions.length > 0" :style="ACTIONS_STYLE">
        <button
          v-for="(action, index) in shownActions"
          :key="`${action.label}-${index}`"
          type="button"
          data-a2ui-input=""
          :style="actionStyle(action)"
          @click.stop="onActionClick(action)"
        >
          {{ action.label }}
        </button>
      </div>
    </div>
  </div>
</template>
