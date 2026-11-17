<script setup lang="ts">
import { computed } from "vue";
import { spacing } from "@copilotkit/shared/generative-ui";
import type { FailedCheck, StyleMap } from "@copilotkit/shared/generative-ui";
import { useGenerativeUIAccessibility, wrapperAria } from "../../accessibility";
import CheckError from "./CheckError.vue";
import { FIELD_LABEL_STYLE } from "./control";

defineOptions({ name: "CopilotGenerativeUIField" });

/**
 * A label above a control, and the message of a failed check under it.
 * With `htmlFor`, the label is a `<label>` of that control. With `labelId`,
 * it is a text that a group points to with `aria-labelledby`.
 */
const props = defineProps<{
  label?: string;
  htmlFor?: string;
  labelId?: string;
  /** The A2UI `weight`: flex-grow in a Row or Column. */
  weight?: number;
  /** The failed check, shown under the control. */
  error?: FailedCheck;
}>();

const emit = defineEmits<{
  /** The focus left the control: it is touched now. */
  touch: [];
}>();

// The envelope of the control: hidden hides label and control; a label or
// a description names the pair as a group, and the control itself takes
// them too (see controlAria), because ARIA names do not inherit.
const aria = useGenerativeUIAccessibility();
const isNamed = computed(
  () =>
    aria.value["aria-label"] !== undefined ||
    aria.value["aria-description"] !== undefined,
);
const style = computed<StyleMap>(() => ({
  display: "flex",
  flexDirection: "column",
  gap: spacing(2),
  width: "100%",
  minWidth: 0,
  flexGrow: props.weight,
}));
</script>

<template>
  <div
    v-bind="wrapperAria(aria)"
    :role="isNamed ? 'group' : undefined"
    :aria-label="isNamed ? aria['aria-label'] : undefined"
    :aria-description="isNamed ? aria['aria-description'] : undefined"
    :style="style"
    @blur.capture="emit('touch')"
  >
    <template v-if="label">
      <label
        v-if="htmlFor !== undefined"
        :for="htmlFor"
        :style="FIELD_LABEL_STYLE"
        >{{ label }}</label
      >
      <span v-else :id="labelId" :style="FIELD_LABEL_STYLE">{{ label }}</span>
    </template>
    <slot />
    <CheckError :check="error" />
  </div>
</template>
