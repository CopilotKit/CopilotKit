<script setup lang="ts">
import { computed, h } from "vue";
import type { CSSProperties, FunctionalComponent } from "vue";
import {
  FONT_WEIGHT,
  borderColor,
  px,
  radius,
  spacing,
  textColor,
  textFont,
} from "@copilotkit/shared/generative-ui";
import { isNativeMarker } from "./list-context";

defineOptions({ name: "CopilotGenerativeUIListItemBody" });

/**
 * @internal
 * The body of a List item or a ListItem: the marker or icon, the label and
 * the value, the description and the default slot. With `onPick`, the
 * whole row is a button.
 */
const props = defineProps<{
  label?: string;
  value?: string | number;
  description?: string;
  icon?: string;
  marker?: string;
  markerSize?: number;
  hasConnector?: boolean;
  onPick?: () => void;
}>();

/** A plain button: no box, the full row is the hit area, a focus ring. */
const ITEM_BUTTON_STYLE: CSSProperties = {
  display: "block",
  width: "100%",
  margin: 0,
  padding: 0,
  border: 0,
  background: "none",
  textAlign: "start",
  cursor: "pointer",
  boxSizing: "border-box",
  borderRadius: radius("xs"),
};
const COLUMN_STYLE: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  minWidth: 0,
  flex: 1,
};
const TITLE_STYLE: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "baseline",
  gap: spacing(3),
  ...textFont("md"),
  color: textColor("default"),
};
const VALUE_STYLE: CSSProperties = {
  fontWeight: FONT_WEIGHT.medium,
  fontVariantNumeric: "tabular-nums",
  textAlign: "end",
  flex: "none",
};
const DESCRIPTION_STYLE: CSSProperties = {
  ...textFont("sm"),
  color: textColor("secondary"),
};

const hasLeading = computed(
  () =>
    props.icon !== undefined ||
    (props.marker !== undefined && !isNativeMarker(props.marker)),
);
const leadingStyle = computed<CSSProperties>(() => ({
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  minWidth: px(props.markerSize ?? 20),
  maxWidth: px(props.markerSize),
  paddingTop: "2px",
  color: textColor("secondary"),
}));
const rowStyle = computed<CSSProperties>(() => ({
  display: hasLeading.value ? "flex" : "block",
  gap: spacing(2),
  alignItems: "flex-start",
  borderInlineStart: props.hasConnector
    ? `2px solid ${borderColor("default")}`
    : undefined,
  paddingInlineStart: props.hasConnector ? spacing(3) : undefined,
}));

/** Wraps the row in a button when there is a `pick`, else renders it as is. */
const PickButton: FunctionalComponent<{ pick: (() => void) | undefined }> = (
  buttonProps,
  { slots },
) => {
  const row = slots.default?.();
  const pick = buttonProps.pick;
  if (!pick) return row;
  return h(
    "button",
    {
      type: "button",
      "data-a2ui-input": "",
      style: ITEM_BUTTON_STYLE,
      onClick: (event: MouseEvent) => {
        event.stopPropagation();
        pick();
      },
    },
    row,
  );
};
PickButton.props = ["pick"];
</script>

<template>
  <PickButton :pick="props.onPick">
    <span :style="rowStyle">
      <span v-if="hasLeading" aria-hidden="true" :style="leadingStyle">
        <template v-if="props.icon === undefined">{{ props.marker }}</template>
      </span>
      <span :style="COLUMN_STYLE">
        <span
          v-if="props.label || props.value !== undefined"
          :style="TITLE_STYLE"
        >
          <span>{{ props.label }}</span>
          <span
            v-if="props.value !== undefined"
            data-a2ui-list-value=""
            :style="VALUE_STYLE"
          >
            {{ props.value }}
          </span>
        </span>
        <span v-if="props.description" :style="DESCRIPTION_STYLE">
          {{ props.description }}
        </span>
        <slot />
      </span>
    </span>
  </PickButton>
</template>
