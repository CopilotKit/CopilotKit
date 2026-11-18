<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from "vue";
import {
  ɵLICENSE_BANNER_STYLE,
  ɵgetLicenseBannerSpec,
  ɵreserveLicenseBannerOffset,
} from "@copilotkit/core";
import type { ɵLicenseBannerType } from "@copilotkit/core";
import { useChatLabels } from "./chat/use-chat-labels";

const props = withDefaults(
  defineProps<{
    type: ɵLicenseBannerType;
    featureName?: string;
    expiryDate?: string;
    graceRemaining?: number;
    onDismiss?: () => void;
  }>(),
  {
    featureName: undefined,
    expiryDate: undefined,
    graceRemaining: undefined,
    onDismiss: undefined,
  },
);

const labels = useChatLabels();

// Core picks the text, link, and severity; this component renders them.
const spec = computed(() =>
  ɵgetLicenseBannerSpec(props.type, labels.value, {
    featureName: props.featureName,
    expiryDate: props.expiryDate,
    graceRemaining: props.graceRemaining,
  }),
);

const containerStyle = computed(() => ({
  ...ɵLICENSE_BANNER_STYLE.base,
  ...ɵLICENSE_BANNER_STYLE.severity[spec.value.severity],
}));

// Publish the banner's reserved bottom offset so the chat input can lift
// itself above it via padding-bottom: var(--copilotkit-license-banner-offset).
let releaseOffset: (() => void) | undefined;
onMounted(() => {
  releaseOffset = ɵreserveLicenseBannerOffset();
});
onBeforeUnmount(() => {
  releaseOffset?.();
  releaseOffset = undefined;
});
</script>

<template>
  <div :style="containerStyle" data-testid="copilot-license-banner">
    <span>{{ spec.message }}</span>
    <div :style="ɵLICENSE_BANNER_STYLE.actions">
      <a
        :href="spec.actionUrl"
        target="_blank"
        rel="noopener noreferrer"
        :style="ɵLICENSE_BANNER_STYLE.link"
      >
        {{ spec.actionLabel }}
      </a>
      <button
        v-if="props.onDismiss"
        :style="ɵLICENSE_BANNER_STYLE.dismiss"
        @click="props.onDismiss"
      >
        ×
      </button>
    </div>
  </div>
</template>
