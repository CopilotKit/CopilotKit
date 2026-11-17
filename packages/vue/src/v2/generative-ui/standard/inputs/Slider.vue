<script setup lang="ts">
import { computed } from "vue";
import { useStandardId } from "../ids";
import {
  FONT_WEIGHT,
  spacing,
  textColor,
  textFont,
} from "@copilotkit/shared/generative-ui";
import type { StyleMap, sliderSchema } from "@copilotkit/shared/generative-ui";
import type { z } from "zod";
import {
  controlAria,
  useGenerativeUIAccessibility,
  wrapperAria,
} from "../../accessibility";
import { useStandardStyles } from "../../standard-styles";
import CheckError from "./CheckError.vue";
import { useChecks } from "./checks";

defineOptions({ name: "CopilotGenerativeUISlider" });

type SliderProps = z.output<typeof sliderSchema>;

/**
 * A range slider for a number between `min` and `max`. The value shows
 * above it, with its unit. `value` is writable: a move emits `update:value`
 * with a number.
 */
const props = defineProps<{
  checks?: SliderProps["checks"];
  /** Default 0. */
  min?: SliderProps["min"];
  /** Default 100. */
  max?: SliderProps["max"];
  /** Default 1. */
  step?: SliderProps["step"];
  /** The number of equal divisions between min and max, instead of step. */
  steps?: SliderProps["steps"];
  /** The visible label of the slider. */
  label?: SliderProps["label"];
  weight?: SliderProps["weight"];
  /** The unit after the value, for example "%". */
  unit?: SliderProps["unit"];
  marks?: SliderProps["marks"];
  /** Default "continuous". "discrete" snaps to the marks. */
  sliderStyle?: SliderProps["sliderStyle"];
  disabled?: SliderProps["disabled"];
  name?: SliderProps["name"];
}>();

/** The number. Writable: a move emits `update:value`. */
const value = defineModel<SliderProps["value"]>("value");

useStandardStyles();
const aria = useGenerativeUIAccessibility();
const id = useStandardId();
const listId = useStandardId();
const { error: checkError, onBlur: touch } = useChecks(
  () => props.checks,
  () => value.value,
);
const min = computed(() => props.min ?? 0);
const max = computed(() => props.max ?? 100);
const current = computed(() => value.value ?? min.value);
const marks = computed(() => props.marks ?? []);
const step = computed(() =>
  props.steps ? (max.value - min.value) / props.steps : (props.step ?? 1),
);
const valueText = computed(() =>
  props.unit ? `${current.value} ${props.unit}` : `${current.value}`,
);
const showValue = computed(() => Boolean(props.label || props.unit));
const isDiscrete = computed(() => props.sliderStyle === "discrete");
const rootStyle = computed<StyleMap>(() => ({
  display: "flex",
  flexDirection: "column",
  gap: spacing(2),
  width: "100%",
  minWidth: 0,
  flexGrow: props.weight,
}));
const HEADER_STYLE: StyleMap = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: spacing(2),
  ...textFont("sm"),
};
const LABEL_STYLE: StyleMap = {
  fontWeight: FONT_WEIGHT.medium,
  color: textColor("secondary"),
};
const VALUE_STYLE: StyleMap = {
  fontWeight: FONT_WEIGHT.semibold,
  fontVariantNumeric: "tabular-nums",
};
const MARKS_STYLE: StyleMap = {
  display: "flex",
  justifyContent: "space-between",
  gap: spacing(2),
  fontSize: ".875em",
  lineHeight: 1.3,
  color: textColor("secondary"),
};

function onInput(event: Event) {
  if (!(event.target instanceof HTMLInputElement)) return;
  value.value = Number(event.target.value);
}
</script>

<template>
  <div v-bind="wrapperAria(aria)" :style="rootStyle" @blur.capture="touch">
    <div :style="HEADER_STYLE">
      <label v-if="label" :for="id" :style="LABEL_STYLE">{{ label }}</label>
      <span v-else />
      <span :style="VALUE_STYLE">{{ showValue ? valueText : "" }}</span>
    </div>
    <input
      :id="id"
      type="range"
      class="a2ui-std-range"
      data-a2ui-input=""
      :name="name"
      :aria-label="label ? undefined : name"
      :aria-valuetext="unit ? valueText : undefined"
      :min="min"
      :max="max"
      :step="step"
      :disabled="disabled"
      :value="current"
      :list="isDiscrete && marks.length > 0 ? listId : undefined"
      v-bind="controlAria(aria)"
      @input="onInput"
    />
    <template v-if="marks.length > 0">
      <datalist :id="listId">
        <option
          v-for="mark in marks"
          :key="mark.value"
          :value="mark.value"
          :label="mark.label"
        />
      </datalist>
      <div aria-hidden="true" :style="MARKS_STYLE">
        <span v-for="mark in marks" :key="mark.value">{{
          mark.label ?? mark.value
        }}</span>
      </div>
    </template>
    <CheckError :check="checkError" />
  </div>
</template>
