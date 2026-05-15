<script setup lang="ts">
import { computed, getCurrentInstance, onBeforeUnmount, onMounted } from "vue";

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
  }>(),
  {
    featureName: undefined,
    expiryDate: undefined,
    graceRemaining: undefined,
  },
);

const emit = defineEmits<{
  dismiss: [];
}>();

interface BannerSpec {
  severity: "info" | "warning" | "critical";
  message: string;
  actionLabel: string;
  actionUrl: string;
}

const spec = computed<BannerSpec | null>(() => {
  switch (props.type) {
    case "no_license":
      return {
        severity: "info",
        message: "Powered by CopilotKit",
        actionLabel: "Get a license",
        actionUrl: "https://copilotkit.ai/pricing",
      };
    case "feature_unlicensed":
      return {
        severity: "warning",
        message: `⚠ The "${props.featureName ?? ""}" feature requires a CopilotKit license.`,
        actionLabel: "Get a license",
        actionUrl: "https://copilotkit.ai/pricing",
      };
    case "expiring": {
      const days = props.graceRemaining;
      const dayLabel = days === 1 ? "day" : "days";
      return {
        severity: "warning",
        message: `Your CopilotKit license expires in ${days} ${dayLabel}. Please renew.`,
        actionLabel: "Renew",
        actionUrl: "https://cloud.copilotkit.ai",
      };
    }
    case "expired":
      return {
        severity: "critical",
        message: `Your CopilotKit license expired${props.expiryDate ? ` on ${props.expiryDate}` : ""}. Please renew at copilotkit.ai/pricing`,
        actionLabel: "Renew now",
        actionUrl: "https://copilotkit.ai/pricing",
      };
    case "invalid":
      return {
        severity: "critical",
        message:
          "Invalid CopilotKit license token. Please check your configuration.",
        actionLabel: "Get a license",
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

const instance = getCurrentInstance();
const hasDismissListener = computed(() => {
  const vnodeProps = (instance?.vnode.props ?? {}) as Record<string, unknown>;
  return typeof vnodeProps.onDismiss === "function";
});

function handleDismiss() {
  emit("dismiss");
}

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
        v-if="hasDismissListener"
        :style="{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          color: 'inherit',
          fontSize: '16px',
        }"
        @click="handleDismiss"
      >
        ×
      </button>
    </div>
  </div>
</template>
