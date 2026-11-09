<script setup lang="ts">
import { computed, useId } from "vue";
import type { FunctionalComponent } from "vue";
import { defined, px, textColor } from "@copilotkit/shared/generative-ui";
import type { StyleMap, selectSchema } from "@copilotkit/shared/generative-ui";
import type { z } from "zod";
import { controlAria, useGenerativeUIAccessibility } from "../../accessibility";
import { useStandardStyles } from "../../standard-styles";
import CopilotGenerativeUILucideIcon from "../media/LucideIcon.vue";
import Field from "./Field.vue";
import { useChecks } from "./checks";
import {
  PAD_X,
  SELECT_STYLE,
  asText,
  controlStyle,
  normalizeOptions,
} from "./control";

defineOptions({ name: "CopilotGenerativeUISelect" });

type SelectProps = z.output<typeof selectSchema>;

/**
 * A dropdown list of options: a native select with the look of the fields.
 * `value` is writable: a choice emits `update:value`.
 *
 * `block` and `pill` default to `undefined`, not `false`: the select is
 * full width and a pill unless they are `false`.
 */
const props = withDefaults(
  defineProps<{
    checks?: SelectProps["checks"];
    /** Plain strings or `{ value, label, description? }`. */
    options?: SelectProps["options"];
    placeholder?: SelectProps["placeholder"];
    /** The visible label of the field. */
    label?: SelectProps["label"];
    name?: SelectProps["name"];
    required?: SelectProps["required"];
    disabled?: SelectProps["disabled"];
    /** Adds the empty option. */
    clearable?: SelectProps["clearable"];
    /** The label of the empty option. */
    clearLabel?: SelectProps["clearLabel"];
    searchable?: SelectProps["searchable"];
    /** A lucide icon name, shown before the value. */
    icon?: SelectProps["icon"];
    /** Full width. */
    block?: SelectProps["block"];
    size?: SelectProps["size"];
    pill?: SelectProps["pill"];
  }>(),
  { block: undefined, pill: undefined },
);

/** The chosen option value. Writable: a choice emits `update:value`. */
const value = defineModel<SelectProps["value"]>("value");

useStandardStyles();
const aria = useGenerativeUIAccessibility();
const id = useId();
const {
  error: checkError,
  invalid: checkInvalid,
  onBlur: touch,
} = useChecks(
  () => props.checks,
  () => value.value,
);
const options = computed(() => normalizeOptions(props.options));
const text = computed(() => asText(value.value));
const hasEmptyOption = computed(() =>
  Boolean(props.placeholder || props.clearable || text.value === ""),
);
// `defined`: an undefined `paddingLeft` would clear the left padding that
// `padding` sets.
const selectStyle = computed<StyleMap>(() =>
  defined({
    ...controlStyle(props, "xl"),
    ...SELECT_STYLE,
    width: props.block === false ? undefined : "100%",
    paddingLeft: props.icon ? `${PAD_X[props.size ?? "xl"] + 24}px` : undefined,
  }),
);
const iconStyle = computed<StyleMap>(() => ({
  position: "absolute",
  left: px(PAD_X[props.size ?? "xl"]),
  top: "50%",
  transform: "translateY(-50%)",
  display: "flex",
  pointerEvents: "none",
  color: textColor("secondary"),
}));
const ICON_ROW_STYLE: StyleMap = {
  position: "relative",
  display: "flex",
  width: "100%",
};
/** Renders its content with no element: the select without an icon row. */
const Bare: FunctionalComponent = (_, { slots }) => slots.default?.();

function onChange(event: Event) {
  if (!(event.target instanceof HTMLSelectElement)) return;
  value.value = event.target.value;
}
</script>

<template>
  <Field :label="label" :html-for="id" :error="checkError" @touch="touch">
    <component
      :is="icon ? 'span' : Bare"
      v-bind="icon ? { style: ICON_ROW_STYLE } : {}"
    >
      <span v-if="icon" aria-hidden="true" :style="iconStyle">
        <CopilotGenerativeUILucideIcon :name="icon" :size="16" />
      </span>
      <select
        :id="id"
        data-a2ui-input=""
        :name="name"
        :aria-label="label ? undefined : placeholder"
        :required="required"
        :disabled="disabled"
        :aria-invalid="checkInvalid || undefined"
        :value="text"
        :style="selectStyle"
        v-bind="controlAria(aria)"
        @change="onChange"
      >
        <option v-if="hasEmptyOption" value="" :selected="text === ''">
          {{ clearLabel ?? placeholder ?? "" }}
        </option>
        <option
          v-for="option in options"
          :key="option.value"
          :value="option.value"
          :title="option.description"
          :selected="option.value === text"
        >
          {{ option.label }}
        </option>
      </select>
    </component>
  </Field>
</template>
