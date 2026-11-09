<script setup lang="ts">
import { computed, ref, useId } from "vue";
import {
  backgroundColor,
  spacing,
  textColor,
} from "@copilotkit/shared/generative-ui";
import type {
  StyleMap,
  choicePickerSchema,
} from "@copilotkit/shared/generative-ui";
import type { z } from "zod";
import { useStandardStyles } from "../../standard-styles";
import Field from "./Field.vue";
import { useChecks } from "./checks";
import {
  OPTION_TEXT_STYLE,
  SMALL_SECONDARY_STYLE,
  controlStyle,
  normalizeOptions,
  radioOptionStyle,
} from "./control";

defineOptions({ name: "CopilotGenerativeUIChoicePicker" });

type ChoicePickerProps = z.output<typeof choicePickerSchema>;

/**
 * One or more options from a list, as checkboxes (or radios, for one
 * choice) or as chips. The value is always a list of option values.
 * `value` is writable: a choice emits `update:value`.
 */
const props = defineProps<{
  checks?: ChoicePickerProps["checks"];
  /** Plain strings or `{ value, label, description? }`. */
  options?: ChoicePickerProps["options"];
  /** The visible label of the group. */
  label?: ChoicePickerProps["label"];
  /** Default "mutuallyExclusive": the user picks one option. */
  variant?: ChoicePickerProps["variant"];
  /** Default "checkbox". "chips" shows the options as pills. */
  displayStyle?: ChoicePickerProps["displayStyle"];
  /** Shows a field that filters the options. */
  filterable?: ChoicePickerProps["filterable"];
  weight?: ChoicePickerProps["weight"];
  disabled?: ChoicePickerProps["disabled"];
  required?: ChoicePickerProps["required"];
}>();

/** The chosen option values. Writable: a choice emits `update:value`. */
const value = defineModel<ChoicePickerProps["value"]>("value");

useStandardStyles();
const labelId = useId();
const fallbackName = useId();
const filter = ref("");
const isMultiple = computed(() => props.variant === "multipleSelection");
const isChips = computed(() => props.displayStyle === "chips");
const chosen = computed(() => (Array.isArray(value.value) ? value.value : []));
const {
  error: checkError,
  invalid: checkInvalid,
  onBlur: touch,
} = useChecks(
  () => props.checks,
  () => chosen.value,
);
const options = computed(() => normalizeOptions(props.options));
const shown = computed(() => {
  const query = filter.value.toLowerCase();
  if (!query) return options.value;
  return options.value.filter((option) =>
    option.label.toLowerCase().includes(query),
  );
});
const filterStyle = computed(() => controlStyle(props, "lg"));
const groupStyle = computed<StyleMap>(() => ({
  display: "flex",
  flexDirection: isChips.value ? "row" : "column",
  flexWrap: isChips.value ? "wrap" : undefined,
  gap: spacing(2),
  opacity: props.disabled ? 0.5 : undefined,
}));
const LIST_OPTION_STYLE = radioOptionStyle("list", false);
// The checkboxes and chips carry no selection of their own, so a sentinel
// input makes an empty required choice fail the Form's constraint
// validation. It is invisible and not in the tab order.
const SENTINEL_STYLE: StyleMap = {
  position: "absolute",
  opacity: 0,
  width: "1px",
  height: "1px",
  margin: 0,
  padding: 0,
  border: 0,
  pointerEvents: "none",
};

function chipStyle(isSelected: boolean): StyleMap {
  return {
    ...radioOptionStyle("pills", isSelected),
    background: isSelected
      ? backgroundColor("surface-secondary")
      : "transparent",
    color: textColor("default"),
    fontFamily: "inherit",
    cursor: props.disabled ? "not-allowed" : "pointer",
  };
}

function toggle(optionValue: string) {
  const list = chosen.value;
  if (!isMultiple.value) {
    value.value = list.includes(optionValue) ? [] : [optionValue];
    return;
  }
  value.value = list.includes(optionValue)
    ? list.filter((item) => item !== optionValue)
    : [...list, optionValue];
}

/** A radio does not fire `change` when it is already checked: its click unchecks it. */
function onOptionClick(optionValue: string) {
  const isCheckedRadio =
    !isMultiple.value && chosen.value.includes(optionValue);
  if (isCheckedRadio) toggle(optionValue);
}

function onFilterInput(event: Event) {
  if (!(event.target instanceof HTMLInputElement)) return;
  filter.value = event.target.value;
}
</script>

<template>
  <Field
    :label="label"
    :label-id="labelId"
    :weight="weight"
    :error="checkError"
    @touch="touch"
  >
    <input
      v-if="filterable"
      type="search"
      data-a2ui-input=""
      aria-label="Filter options"
      placeholder="Filter…"
      :value="filter"
      :disabled="disabled"
      :style="filterStyle"
      @input="onFilterInput"
    />
    <input
      v-if="required"
      tabindex="-1"
      aria-hidden="true"
      required
      :disabled="disabled"
      :value="chosen.join(',')"
      :style="SENTINEL_STYLE"
    />
    <div
      :role="isChips || isMultiple ? 'group' : 'radiogroup'"
      :aria-labelledby="label ? labelId : undefined"
      :aria-required="required || undefined"
      :aria-invalid="checkInvalid || undefined"
      :style="groupStyle"
    >
      <template v-for="option in shown" :key="option.value">
        <button
          v-if="isChips"
          type="button"
          data-a2ui-input=""
          :aria-pressed="chosen.includes(option.value)"
          :disabled="disabled"
          :style="chipStyle(chosen.includes(option.value))"
          @click="toggle(option.value)"
        >
          {{ option.label }}
        </button>
        <label v-else :style="LIST_OPTION_STYLE">
          <input
            :type="isMultiple ? 'checkbox' : 'radio'"
            class="a2ui-std-check"
            data-a2ui-input=""
            :name="fallbackName"
            :value="option.value"
            :checked="chosen.includes(option.value)"
            :disabled="disabled"
            @change="toggle(option.value)"
            @click="onOptionClick(option.value)"
          />
          <span :style="OPTION_TEXT_STYLE">
            <span>{{ option.label }}</span>
            <span v-if="option.description" :style="SMALL_SECONDARY_STYLE">{{
              option.description
            }}</span>
          </span>
        </label>
      </template>
    </div>
  </Field>
</template>
