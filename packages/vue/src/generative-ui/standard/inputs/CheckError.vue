<script setup lang="ts">
import { checkMessageStyle } from "@copilotkit/shared/generative-ui";
import type { FailedCheck } from "@copilotkit/shared/generative-ui";

defineOptions({ name: "CopilotGenerativeUICheckError" });

/**
 * The message of a failed check, under a control. Nothing when none. An
 * error is an alert. A warning or an info is a status, in its own color.
 */
defineProps<{
  /** The failed check to show, or `undefined` for none. */
  check: FailedCheck | undefined;
}>();
</script>

<template>
  <span
    v-if="check"
    :role="check.severity === 'error' ? 'alert' : 'status'"
    data-a2ui-check-error=""
    :data-a2ui-check-severity="check.severity"
    :data-a2ui-check-code="check.code"
    :style="checkMessageStyle(check.severity)"
    >{{ check.message }}</span
  >
</template>
