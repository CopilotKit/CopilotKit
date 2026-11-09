<script setup lang="ts">
import { computed, useId } from "vue";
import type { textFieldSchema } from "@copilotkit/shared/generative-ui";
import type { z } from "zod";
import { controlAria, useGenerativeUIAccessibility } from "../../accessibility";
import { useStandardStyles } from "../../standard-styles";
import Field from "./Field.vue";
import TextArea from "./TextArea.vue";
import { useChecks } from "./checks";
import { asText, controlStyle } from "./control";

defineOptions({ name: "CopilotGenerativeUITextField" });

type TextFieldProps = z.output<typeof textFieldSchema>;

/** The `type` of the input of each single-line TextField variant. */
const TEXT_FIELD_TYPE = {
  shortText: "text",
  number: "number",
  obscured: "password",
  email: "email",
  url: "url",
  tel: "tel",
} as const;

/**
 * A text input, single-line unless `variant` is "longText" (then it is a
 * TextArea). `value` is writable: what the user types emits `update:value`.
 *
 * `pill` defaults to `undefined`, not `false`: an unset `pill` is a pill.
 */
const props = withDefaults(
  defineProps<{
    checks?: TextFieldProps["checks"];
    placeholder?: TextFieldProps["placeholder"];
    /** The visible label of the field. */
    label?: TextFieldProps["label"];
    variant?: TextFieldProps["variant"];
    weight?: TextFieldProps["weight"];
    name?: TextFieldProps["name"];
    required?: TextFieldProps["required"];
    disabled?: TextFieldProps["disabled"];
    invalid?: TextFieldProps["invalid"];
    size?: TextFieldProps["size"];
    pill?: TextFieldProps["pill"];
    /** Selects the text when the field gets the focus. */
    autoSelect?: TextFieldProps["autoSelect"];
    mask?: TextFieldProps["mask"];
  }>(),
  { pill: undefined },
);

/** The text, or a number for `variant: "number"`. Writable: typing emits `update:value`. */
const value = defineModel<TextFieldProps["value"]>("value");

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
const variant = computed(() => props.variant ?? "shortText");
const text = computed(() => asText(value.value));
const style = computed(() => controlStyle(props, "xl"));
// Without a visible label, the placeholder still names the field.
const placeholderName = computed(() =>
  props.label ? undefined : props.placeholder,
);

function onFocus(event: FocusEvent) {
  if (!props.autoSelect) return;
  if (event.target instanceof HTMLInputElement) event.target.select();
}

function onInput(event: Event) {
  if (!(event.target instanceof HTMLInputElement)) return;
  value.value = event.target.value;
}
</script>

<template>
  <TextArea
    v-if="variant === 'longText'"
    :checks="checks"
    :value="text"
    :placeholder="placeholder"
    :label="label"
    :name="name"
    :required="required"
    :disabled="disabled"
    :invalid="invalid"
    :size="size"
    :weight="weight"
    @update:value="value = $event"
  />
  <Field
    v-else
    :label="label"
    :html-for="id"
    :weight="weight"
    :error="checkError"
    @touch="touch"
  >
    <input
      :id="id"
      data-a2ui-input=""
      :type="TEXT_FIELD_TYPE[variant]"
      :name="name"
      :placeholder="placeholder"
      :aria-label="placeholderName"
      :required="required"
      :disabled="disabled"
      :aria-invalid="invalid || checkInvalid || undefined"
      :value="text"
      :style="style"
      v-bind="controlAria(aria)"
      @focus="onFocus"
      @input="onInput"
    />
  </Field>
</template>
