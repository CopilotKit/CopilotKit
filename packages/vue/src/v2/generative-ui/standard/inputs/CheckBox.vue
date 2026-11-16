<script setup lang="ts">
import { computed } from "vue";
import { spacing, textColor, textFont } from "@copilotkit/shared/generative-ui";
import type {
  StyleMap,
  checkBoxSchema,
} from "@copilotkit/shared/generative-ui";
import type { z } from "zod";
import {
  controlAria,
  useGenerativeUIAccessibility,
  wrapperAria,
} from "../../accessibility";
import { useStandardStyles } from "../../standard-styles";
import CheckError from "./CheckError.vue";
import { useChecks } from "./checks";

defineOptions({ name: "CopilotGenerativeUICheckBox" });

type CheckBoxProps = z.output<typeof checkBoxSchema>;

/**
 * A checkbox with a label. Its writable prop is `value` (true when
 * checked), as the A2UI catalog names it, not `checked`.
 */
const props = defineProps<{
  checks?: CheckBoxProps["checks"];
  /** The label text. */
  label?: CheckBoxProps["label"];
  name?: CheckBoxProps["name"];
  weight?: CheckBoxProps["weight"];
  disabled?: CheckBoxProps["disabled"];
  required?: CheckBoxProps["required"];
  /** Strikes the label when the box is checked. */
  lineThrough?: CheckBoxProps["lineThrough"];
  /** Default "round". */
  shape?: CheckBoxProps["shape"];
}>();

/** True when checked. Writable: a click emits `update:value`. */
const value = defineModel<CheckBoxProps["value"]>("value");

useStandardStyles();
const aria = useGenerativeUIAccessibility();
const {
  error: checkError,
  invalid: checkInvalid,
  onBlur: touch,
} = useChecks(
  () => props.checks,
  () => value.value,
);
const isChecked = computed(() => Boolean(value.value));
const hasLabel = computed(
  () => props.label !== undefined && props.label !== "",
);
const rootStyle = computed<StyleMap>(() => ({
  display: "inline-flex",
  flexDirection: "column",
  gap: spacing(1),
  flexGrow: props.weight,
}));
const labelStyle = computed<StyleMap>(() => ({
  display: "inline-flex",
  alignItems: "center",
  flexGrow: props.weight,
  gap: spacing(2),
  cursor: props.disabled ? "not-allowed" : "pointer",
  opacity: props.disabled ? 0.5 : undefined,
  ...textFont("md"),
  color: textColor("default"),
}));

const STRUCK_STYLE: StyleMap = { textDecoration: "line-through" };

function onChange(event: Event) {
  if (!(event.target instanceof HTMLInputElement)) return;
  value.value = event.target.checked;
}
</script>

<template>
  <span v-bind="wrapperAria(aria)" :style="rootStyle" @blur.capture="touch">
    <label :style="labelStyle">
      <input
        type="checkbox"
        class="a2ui-std-check"
        data-a2ui-input=""
        :data-shape="shape ?? 'round'"
        :name="name"
        :aria-label="hasLabel ? undefined : name"
        :required="required"
        :disabled="disabled"
        :checked="isChecked"
        :aria-invalid="checkInvalid || undefined"
        v-bind="controlAria(aria)"
        @change="onChange"
      />
      <span
        v-if="hasLabel"
        :style="lineThrough && isChecked ? STRUCK_STYLE : undefined"
        >{{ label }}</span
      >
    </label>
    <CheckError :check="checkError" />
  </span>
</template>
