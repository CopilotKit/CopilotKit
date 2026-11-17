<script setup lang="ts">
import { computed } from "vue";
import {
  ɵINLINE_FEATURE_WARNING_STYLE,
  ɵgetInlineFeatureWarningSpec,
} from "@copilotkit/core";
import { useChatLabels } from "./chat/use-chat-labels";

const props = defineProps<{
  featureName: string;
}>();

const labels = useChatLabels();
const spec = computed(() =>
  ɵgetInlineFeatureWarningSpec(props.featureName, labels.value),
);
</script>

<template>
  <div
    :style="ɵINLINE_FEATURE_WARNING_STYLE.container"
    data-testid="copilot-inline-feature-warning"
  >
    {{ spec.message }}
    <a
      :href="spec.actionUrl"
      target="_blank"
      rel="noopener noreferrer"
      :style="ɵINLINE_FEATURE_WARNING_STYLE.link"
    >
      {{ spec.actionLabel }}
    </a>
  </div>
</template>
