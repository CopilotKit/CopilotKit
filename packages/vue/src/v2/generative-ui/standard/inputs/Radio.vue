<script setup lang="ts">
import { spacing, textFont } from "@copilotkit/shared/generative-ui";
import type { StyleMap, radioSchema } from "@copilotkit/shared/generative-ui";
import type { z } from "zod";
import {
  controlAria,
  useGenerativeUIAccessibility,
  wrapperAria,
} from "../../accessibility";
import { useStandardStyles } from "../../standard-styles";

defineOptions({ name: "CopilotGenerativeUIRadio" });

type RadioProps = z.output<typeof radioSchema>;

/**
 * One bare radio button with a label. It keeps no chosen value: RadioGroup
 * does.
 */
defineProps<{
  value?: RadioProps["value"];
  /** The label. Default: the value. */
  label?: RadioProps["label"];
  disabled?: RadioProps["disabled"];
  required?: RadioProps["required"];
}>();

useStandardStyles();
const aria = useGenerativeUIAccessibility();
const STYLE: StyleMap = {
  display: "inline-flex",
  alignItems: "center",
  gap: spacing(2),
  ...textFont("md"),
};
</script>

<template>
  <label v-bind="wrapperAria(aria)" :style="STYLE">
    <input
      type="radio"
      class="a2ui-std-check"
      data-a2ui-input=""
      :value="value"
      :disabled="disabled"
      :required="required"
      v-bind="controlAria(aria)"
    />{{ label ?? value }}
  </label>
</template>
