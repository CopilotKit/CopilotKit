<script setup lang="ts">
import { computed } from "vue";
import type { CSSProperties } from "vue";
import type { z } from "zod";
import {
  backgroundColor,
  borderColor,
  faviconSrc,
  hostOf,
  radius,
  safeHref,
  spacing,
} from "@copilotkit/shared/generative-ui";
import type { linkCardSchema } from "@copilotkit/shared/generative-ui";
import { useStandardStyles } from "../../standard-styles";
import type { GenerativeUIEventProp } from "../context";
import {
  CLAMP_TWO,
  FAVICON_STYLE,
  SECONDARY_SM,
  SECONDARY_XS,
  TITLE_MD,
} from "./styles";

defineOptions({ name: "CopilotGenerativeUILinkCard" });

type LinkCardProps = z.output<typeof linkCardSchema>;

/**
 * A preview card of a URL: favicon and domain, title, description and a
 * thumbnail. It is a new-tab `<a>`. When `onClick` is bound, it is a
 * `<button>` that sends `onClick` instead.
 */
const props = withDefaults(
  defineProps<{
    /** The URL. Only http, https and mailto become a link. */
    href: LinkCardProps["href"];
    title: LinkCardProps["title"];
    description?: LinkCardProps["description"];
    /** A thumbnail URL. */
    image?: LinkCardProps["image"];
    /** Shown next to the favicon. Default: the host of `href`. */
    domain?: LinkCardProps["domain"];
    /** `false` hides the favicon. */
    favicon?: LinkCardProps["favicon"];
    /** Sent when the user clicks the card, instead of the link. */
    onClick?: GenerativeUIEventProp;
  }>(),
  // No boolean casting: an unset `favicon` shows the favicon.
  { favicon: undefined },
);

useStandardStyles();

const safeUrl = computed(() => safeHref(props.href));
const host = computed(() =>
  safeUrl.value ? hostOf(safeUrl.value) : undefined,
);
const shownDomain = computed(() => props.domain || host.value || "");

const LINK_STYLE: CSSProperties = {
  display: "flex",
  gap: spacing(3),
  alignItems: "flex-start",
  padding: spacing(3),
  border: `1px solid ${borderColor("default")}`,
  borderRadius: radius("xl"),
  background: backgroundColor("surface"),
  color: "inherit",
  textDecoration: "none",
  width: "100%",
  boxSizing: "border-box",
  cursor: "pointer",
  textAlign: "start",
};
const BODY_STYLE: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "4px",
  minWidth: 0,
  flex: 1,
};
const DOMAIN_STYLE: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "6px",
  ...SECONDARY_XS,
};
const DOMAIN_TEXT_STYLE: CSSProperties = {
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};
const TITLE_STYLE: CSSProperties = { ...TITLE_MD, ...CLAMP_TWO };
const DESCRIPTION_STYLE: CSSProperties = { ...SECONDARY_SM, ...CLAMP_TWO };
const IMAGE_STYLE: CSSProperties = {
  width: "96px",
  height: "96px",
  objectFit: "cover",
  borderRadius: radius("md"),
  flex: "none",
};

/** The root element: a button while `onClick` is bound, else a link. */
const root = computed(() =>
  props.onClick
    ? {
        tag: "button",
        attrs: {
          type: "button",
          "data-a2ui-input": "",
          style: { ...LINK_STYLE, font: "inherit" },
        },
      }
    : {
        tag: "a",
        attrs: {
          href: safeUrl.value,
          target: "_blank",
          rel: "noopener noreferrer",
          style: LINK_STYLE,
        },
      },
);

function onRootClick(event: MouseEvent) {
  const click = props.onClick;
  if (!click) return;
  event.stopPropagation();
  void click({});
}
</script>

<template>
  <component
    :is="root.tag"
    data-a2ui-link-card=""
    v-bind="root.attrs"
    @click="onRootClick"
  >
    <span :style="BODY_STYLE">
      <span v-if="shownDomain" :style="DOMAIN_STYLE">
        <img
          v-if="favicon !== false && host"
          :src="faviconSrc(host)"
          alt=""
          width="16"
          height="16"
          :style="FAVICON_STYLE"
        />
        <span :style="DOMAIN_TEXT_STYLE">{{ shownDomain }}</span>
      </span>
      <span :style="TITLE_STYLE">{{ title }}</span>
      <span v-if="description" :style="DESCRIPTION_STYLE">{{
        description
      }}</span>
    </span>
    <img v-if="image" :src="image" alt="" loading="lazy" :style="IMAGE_STYLE" />
  </component>
</template>
