<script setup lang="ts">
import { computed } from "vue";
import { useStandardId } from "../ids";
import type { ComponentPublicInstance } from "vue";
import {
  ACCENT,
  FONT_WEIGHT,
  ON_ACCENT,
  SHADOW_XS,
  backgroundColor,
  borderColor,
  px,
  radius,
  textColor,
} from "@copilotkit/shared/generative-ui";
import type {
  StyleMap,
  segmentedControlSchema,
} from "@copilotkit/shared/generative-ui";
import type { z } from "zod";
import { useStandardStyles } from "../../standard-styles";
import Field from "./Field.vue";
import { useChecks } from "./checks";
import { FONT_SIZE, HEIGHT, PAD_X, asText, normalizeOptions } from "./control";

defineOptions({ name: "CopilotGenerativeUISegmentedControl" });

type SegmentedControlProps = z.output<typeof segmentedControlSchema>;

/**
 * A radio group drawn as buttons. It is one tab stop: the selected segment
 * (or the first one) is in the tab order, and the arrow keys, Home and End
 * move the focus and select the segment. `value` is writable: a choice
 * emits `update:value`.
 *
 * `pill` defaults to `undefined`, not `false`: an unset `pill` is a pill.
 */
const props = withDefaults(
  defineProps<{
    checks?: SegmentedControlProps["checks"];
    /** Plain strings or `{ value, label, description? }`. */
    options?: SegmentedControlProps["options"];
    /** The visible label of the group. */
    label?: SegmentedControlProps["label"];
    /** Full width. */
    block?: SegmentedControlProps["block"];
    size?: SegmentedControlProps["size"];
    pill?: SegmentedControlProps["pill"];
    /** Default "ghost". */
    variant?: SegmentedControlProps["variant"];
    disabled?: SegmentedControlProps["disabled"];
  }>(),
  { pill: undefined },
);

/** The chosen option value. Writable: a choice emits `update:value`. */
const value = defineModel<SegmentedControlProps["value"]>("value");

useStandardStyles();
const labelId = useStandardId();
const segments: (HTMLButtonElement | null)[] = [];
const { error: checkError, onBlur: touch } = useChecks(
  () => props.checks,
  () => value.value,
);
const options = computed(() => normalizeOptions(props.options));
const isPill = computed(() => props.pill !== false);
const selectedIndex = computed(() =>
  options.value.findIndex((option) => option.value === asText(value.value)),
);
const tabStopIndex = computed(() =>
  selectedIndex.value === -1 ? 0 : selectedIndex.value,
);
const groupStyle = computed<StyleMap>(() => ({
  display: props.block ? "flex" : "inline-flex",
  width: props.block ? "100%" : undefined,
  gap: px(2),
  padding: px(2),
  boxSizing: "border-box",
  background: backgroundColor("surface-secondary"),
  border:
    props.variant === "outline"
      ? `1px solid ${borderColor("default")}`
      : undefined,
  borderRadius: isPill.value ? "9999px" : radius("md"),
  opacity: props.disabled ? 0.5 : undefined,
}));

function segmentStyle(isSelected: boolean): StyleMap {
  const segmentSize = props.size ?? "lg";
  const isSolid = props.variant === "solid";
  const selectedBackground = isSolid ? ACCENT : backgroundColor("surface");
  const selectedColor = isSolid ? ON_ACCENT : textColor("default");
  return {
    flex: props.block ? 1 : undefined,
    minHeight: px(HEIGHT[segmentSize] - 4),
    padding: `0 ${PAD_X[segmentSize]}px`,
    fontSize: FONT_SIZE[segmentSize],
    fontFamily: "inherit",
    fontWeight: FONT_WEIGHT.medium,
    border: "none",
    cursor: props.disabled ? "not-allowed" : "pointer",
    borderRadius: isPill.value ? "9999px" : radius("sm"),
    background: isSelected ? selectedBackground : "transparent",
    color: isSelected ? selectedColor : textColor("secondary"),
    boxShadow: isSelected && !isSolid ? SHADOW_XS : undefined,
  };
}

/**
 * The option that an arrow key, Home or End moves to, or `undefined` for
 * other keys. The arrow keys wrap at the ends.
 */
function nextOptionIndex(key: string, index: number, count: number) {
  switch (key) {
    case "ArrowRight":
    case "ArrowDown":
      return (index + 1) % count;
    case "ArrowLeft":
    case "ArrowUp":
      return (index - 1 + count) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return undefined;
  }
}

function setSegment(
  index: number,
  element: Element | ComponentPublicInstance | null,
) {
  segments[index] = element instanceof HTMLButtonElement ? element : null;
}

function onKeyDown(event: KeyboardEvent, index: number) {
  const next = nextOptionIndex(event.key, index, options.value.length);
  if (next === undefined) return;
  event.preventDefault();
  const option = options.value[next];
  if (option === undefined) return;
  value.value = option.value;
  segments[next]?.focus();
}
</script>

<template>
  <Field :label="label" :label-id="labelId" :error="checkError" @touch="touch">
    <div
      role="radiogroup"
      :aria-labelledby="label ? labelId : undefined"
      :style="groupStyle"
    >
      <button
        v-for="(option, index) in options"
        :key="option.value"
        :ref="(element) => setSegment(index, element)"
        type="button"
        role="radio"
        :aria-checked="index === selectedIndex"
        :tabindex="index === tabStopIndex ? 0 : -1"
        data-a2ui-input=""
        :disabled="disabled"
        :style="segmentStyle(index === selectedIndex)"
        @click.stop="value = option.value"
        @keydown="onKeyDown($event, index)"
      >
        {{ option.label }}
      </button>
    </div>
  </Field>
</template>
