<script setup lang="ts">
defineProps<{
  featureName: string;
}>();

const containerStyle = {
  padding: "8px 12px",
  backgroundColor: "#fffbeb",
  border: "1px solid #fbbf24",
  borderRadius: "6px",
  fontSize: "13px",
  color: "#92400e",
  fontFamily:
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif",
} as const;

const linkStyle = {
  color: "#b45309",
  textDecoration: "underline",
} as const;
</script>

<template>
  <div :style="containerStyle" data-testid="copilot-inline-feature-warning">
    ⚠ The "{{ featureName }}" feature requires a CopilotKit license.
    <a
      href="https://copilotkit.ai/pricing"
      target="_blank"
      rel="noopener noreferrer"
      :style="linkStyle"
    >
      Get one at copilotkit.ai/pricing
    </a>
  </div>
</template>
