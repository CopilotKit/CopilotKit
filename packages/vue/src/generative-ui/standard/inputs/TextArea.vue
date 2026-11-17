<script setup lang="ts">
import { computed, useTemplateRef, watchEffect } from "vue";
import { useStandardId } from "../ids";
import { defined } from "@copilotkit/shared/generative-ui";
import type {
  StyleMap,
  textAreaSchema,
} from "@copilotkit/shared/generative-ui";
import type { z } from "zod";
import { controlAria, useGenerativeUIAccessibility } from "../../accessibility";
import { useStandardStyles } from "../../standard-styles";
import Field from "./Field.vue";
import { useChecks } from "./checks";
import { PAD_X, asText, controlStyle } from "./control";

defineOptions({ name: "CopilotGenerativeUITextArea" });

type TextAreaProps = z.output<typeof textAreaSchema>;

/**
 * A multi-line text input. `value` is writable: what the user types emits
 * `update:value`. With `autoResize`, the field grows with its text, also
 * when the agent or the data model sets the text.
 */
const props = defineProps<{
  checks?: TextAreaProps["checks"];
  placeholder?: TextAreaProps["placeholder"];
  /** The visible label of the field. */
  label?: TextAreaProps["label"];
  weight?: TextAreaProps["weight"];
  /** The visible rows. Default 3. */
  rows?: TextAreaProps["rows"];
  maxRows?: TextAreaProps["maxRows"];
  autoResize?: TextAreaProps["autoResize"];
  name?: TextAreaProps["name"];
  required?: TextAreaProps["required"];
  disabled?: TextAreaProps["disabled"];
  invalid?: TextAreaProps["invalid"];
  size?: TextAreaProps["size"];
}>();

/** The text. Writable: typing emits `update:value`. */
const value = defineModel<TextAreaProps["value"]>("value");

useStandardStyles();
const aria = useGenerativeUIAccessibility();
const id = useStandardId();
const area = useTemplateRef<HTMLTextAreaElement>("area");
const {
  error: checkError,
  invalid: checkInvalid,
  onBlur: touch,
} = useChecks(
  () => props.checks,
  () => value.value,
);
const text = computed(() => asText(value.value));

const style = computed<StyleMap>(() => {
  const areaSize = props.size ?? "xl";
  return defined({
    ...controlStyle(
      {
        size: props.size,
        invalid: props.invalid,
        disabled: props.disabled,
        pill: false,
      },
      areaSize,
    ),
    padding: `${PAD_X[areaSize] / 2}px ${PAD_X[areaSize]}px`,
    resize: props.autoResize ? "none" : "vertical",
    maxHeight: props.maxRows
      ? `calc(${props.maxRows} * 1.5em + ${PAD_X[areaSize]}px)`
      : undefined,
    lineHeight: 1.5,
  });
});

// After the render: the text must be in the element before its height can
// follow it. A `post` effect does not run on the server.
watchEffect(
  () => {
    void text.value;
    const element = area.value;
    if (!props.autoResize || !element) return;
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;
  },
  { flush: "post" },
);

function onInput(event: Event) {
  if (!(event.target instanceof HTMLTextAreaElement)) return;
  value.value = event.target.value;
}
</script>

<template>
  <Field
    :label="label"
    :html-for="id"
    :weight="weight"
    :error="checkError"
    @touch="touch"
  >
    <textarea
      :id="id"
      ref="area"
      data-a2ui-input=""
      :name="name"
      :placeholder="placeholder"
      :aria-label="label ? undefined : placeholder"
      :required="required"
      :disabled="disabled"
      :aria-invalid="invalid || checkInvalid || undefined"
      :rows="rows ?? 3"
      :value="text"
      :style="style"
      v-bind="controlAria(aria)"
      @input="onInput"
    />
  </Field>
</template>
