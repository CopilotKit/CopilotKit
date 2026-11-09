<script setup lang="ts">
import { computed, useId } from "vue";
import { spacing } from "@copilotkit/shared/generative-ui";
import type {
  StyleMap,
  radioGroupSchema,
} from "@copilotkit/shared/generative-ui";
import type { z } from "zod";
import { useGenerativeUIAccessibility } from "../../accessibility";
import { useStandardStyles } from "../../standard-styles";
import CheckError from "./CheckError.vue";
import { useChecks } from "./checks";
import {
  FIELD_LABEL_STYLE,
  OPTION_TEXT_STYLE,
  SMALL_SECONDARY_STYLE,
  asText,
  normalizeOptions,
  radioOptionStyle,
} from "./control";

defineOptions({ name: "CopilotGenerativeUIRadioGroup" });

type RadioGroupProps = z.output<typeof radioGroupSchema>;

/**
 * Native radios in a fieldset, so the arrow keys work without extra code.
 * The legend names the group. `value` is writable: a choice emits
 * `update:value`.
 */
const props = defineProps<{
  checks?: RadioGroupProps["checks"];
  /** Plain strings or `{ value, label, description? }`. */
  options?: RadioGroupProps["options"];
  /** The visible label of the group. */
  label?: RadioGroupProps["label"];
  /** The name of the radios. Default: a unique name. */
  name?: RadioGroupProps["name"];
  /** Default "row". */
  direction?: RadioGroupProps["direction"];
  /** Default "list". */
  variant?: RadioGroupProps["variant"];
  disabled?: RadioGroupProps["disabled"];
  required?: RadioGroupProps["required"];
}>();

/** The chosen option value. Writable: a choice emits `update:value`. */
const value = defineModel<RadioGroupProps["value"]>("value");

useStandardStyles();
const aria = useGenerativeUIAccessibility();
const fallbackName = useId();
const {
  error: checkError,
  invalid: checkInvalid,
  onBlur: touch,
} = useChecks(
  () => props.checks,
  () => value.value,
);
const groupName = computed(() => props.name ?? fallbackName);
const options = computed(() => normalizeOptions(props.options));
const text = computed(() => asText(value.value));
const variant = computed(() => props.variant ?? "list");
const FIELDSET_STYLE: StyleMap = {
  border: 0,
  margin: 0,
  padding: 0,
  minWidth: 0,
};
const LEGEND_STYLE: StyleMap = {
  ...FIELD_LABEL_STYLE,
  padding: 0,
  marginBottom: spacing(1),
};
const listStyle = computed<StyleMap>(() => ({
  display: "flex",
  flexDirection: props.direction === "col" ? "column" : "row",
  flexWrap: "wrap",
  gap: spacing(variant.value === "list" ? 3 : 2),
}));
</script>

<template>
  <fieldset
    :disabled="disabled"
    :aria-invalid="checkInvalid || undefined"
    :style="FIELDSET_STYLE"
    v-bind="aria"
    @blur.capture="touch"
  >
    <legend v-if="label" :style="LEGEND_STYLE">{{ label }}</legend>
    <div :style="listStyle">
      <label
        v-for="option in options"
        :key="option.value"
        :style="radioOptionStyle(variant, option.value === text)"
      >
        <input
          type="radio"
          data-a2ui-input=""
          :name="groupName"
          :value="option.value"
          :required="required"
          :checked="option.value === text"
          class="a2ui-std-check"
          @change="value = option.value"
        />
        <span :style="OPTION_TEXT_STYLE">
          <span>{{ option.label }}</span>
          <span v-if="option.description" :style="SMALL_SECONDARY_STYLE">{{
            option.description
          }}</span>
        </span>
      </label>
    </div>
    <CheckError :check="checkError" />
  </fieldset>
</template>
