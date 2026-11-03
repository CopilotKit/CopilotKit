<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from "vue";
import { ɵformatLabel } from "@copilotkit/core";
import { useChatLabels } from "./chat/use-chat-labels";

// Total reserved vertical space for the fixed license banner: banner height
// (~36px) + bottom offset (8px) + visual gap above the chat input (~8px).
const LICENSE_BANNER_OFFSET_PX = 52;
const LICENSE_BANNER_OFFSET_VAR = "--copilotkit-license-banner-offset";

type LicenseBannerType =
  | "no_license"
  | "expired"
  | "expiring"
  | "invalid"
  | "feature_unlicensed";

const props = withDefaults(
  defineProps<{
    type: LicenseBannerType;
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

interface BannerSpec {
  severity: "info" | "warning" | "critical";
  message: string;
  actionLabel: string;
  actionUrl: string;
}

const labels = useChatLabels();

function expiringMessage(days: number | undefined) {
  if (days === undefined) return labels.value.licenseExpiringText;
  const template =
    days === 1
      ? labels.value.licenseExpiringInDaysOne
      : labels.value.licenseExpiringInDaysOther;
  return ɵformatLabel(template, { days });
}

const spec = computed<BannerSpec | null>(() => {
  const text = labels.value;
  switch (props.type) {
    case "no_license":
      return {
        severity: "info",
        message: text.licensePoweredByText,
        actionLabel: text.licenseGetLicenseLabel,
        actionUrl: "https://copilotkit.ai/pricing",
      };
    case "feature_unlicensed":
      return {
        severity: "warning",
        message: ɵformatLabel(text.licenseFeatureUnlicensedText, {
          feature: props.featureName ?? "",
        }),
        actionLabel: text.licenseGetLicenseLabel,
        actionUrl: "https://copilotkit.ai/pricing",
      };
    case "expiring":
      return {
        severity: "warning",
        message: expiringMessage(props.graceRemaining),
        actionLabel: text.licenseRenewLabel,
        actionUrl: "https://dashboard.operations.copilotkit.ai",
      };
    case "expired":
      return {
        severity: "critical",
        message: props.expiryDate
          ? ɵformatLabel(text.licenseExpiredOnDateText, {
              date: props.expiryDate,
            })
          : text.licenseExpiredText,
        actionLabel: text.licenseRenewNowLabel,
        actionUrl: "https://copilotkit.ai/pricing",
      };
    case "invalid":
      return {
        severity: "critical",
        message: text.licenseInvalidText,
        actionLabel: text.licenseGetLicenseLabel,
        actionUrl: "https://copilotkit.ai/pricing",
      };
    default:
      return null;
  }
});

const baseStyle = {
  position: "fixed",
  bottom: "8px",
  left: "50%",
  transform: "translateX(-50%)",
  zIndex: 99999,
  display: "inline-flex",
  alignItems: "center",
  gap: "12px",
  whiteSpace: "nowrap",
  padding: "8px 16px",
  fontSize: "13px",
  fontFamily:
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif",
  borderRadius: "6px",
  boxShadow: "0 2px 8px rgba(0, 0, 0, 0.15)",
} as const;

const severityStyle = computed(() => {
  switch (spec.value?.severity) {
    case "warning":
      return {
        backgroundColor: "#fffbeb",
        border: "1px solid #fbbf24",
        color: "#92400e",
      };
    case "critical":
      return {
        backgroundColor: "#fef2f2",
        border: "1px solid #fca5a5",
        color: "#991b1b",
      };
    default:
      return {
        backgroundColor: "#eff6ff",
        border: "1px solid #93c5fd",
        color: "#1e40af",
      };
  }
});

const containerStyle = computed(() => ({
  ...baseStyle,
  ...severityStyle.value,
}));

// Publish the banner's reserved bottom offset so the chat input can lift
// itself above it via padding-bottom: var(--copilotkit-license-banner-offset).
onMounted(() => {
  if (typeof document === "undefined") return;
  document.documentElement.style.setProperty(
    LICENSE_BANNER_OFFSET_VAR,
    `${LICENSE_BANNER_OFFSET_PX}px`,
  );
});

onBeforeUnmount(() => {
  if (typeof document === "undefined") return;
  document.documentElement.style.removeProperty(LICENSE_BANNER_OFFSET_VAR);
});
</script>

<template>
  <div v-if="spec" :style="containerStyle" data-testid="copilot-license-banner">
    <span>{{ spec.message }}</span>
    <div
      :style="{
        display: 'flex',
        gap: '8px',
        alignItems: 'center',
      }"
    >
      <a
        :href="spec.actionUrl"
        target="_blank"
        rel="noopener noreferrer"
        :style="{
          fontWeight: 600,
          textDecoration: 'underline',
          color: 'inherit',
        }"
      >
        {{ spec.actionLabel }}
      </a>
      <button
        v-if="props.onDismiss"
        :style="{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          color: 'inherit',
          fontSize: '16px',
        }"
        @click="props.onDismiss"
      >
        ×
      </button>
    </div>
  </div>
</template>
