<script setup lang="ts">
/**
 * Experimental. The card around a surface in the chat, for the tool
 * transport. The default slot is the surface. A rejected operation adds one
 * generic line; the reasons are in `rejected`. Replace the card with the
 * `#generative-ui-surface` slot of `CopilotChat`.
 *
 * The error line is interpolated, so its text has no leading or trailing
 * space.
 */
import type { GenerativeUIChatSurfaceProps } from "./chat";

defineOptions({ name: "DefaultGenerativeUIChatCard" });
defineProps<GenerativeUIChatSurfaceProps>();
defineSlots<{ default?: () => unknown }>();
</script>

<template>
  <div
    :data-generative-ui-chat-surface="surfaceId"
    class="cpk:my-2 cpk:w-full cpk:rounded-xl cpk:border cpk:border-gray-200 cpk:p-3"
  >
    <slot />
    <div
      v-if="error"
      role="alert"
      class="cpk:mt-2 cpk:text-xs cpk:text-red-600"
    >
      {{ "Part of this UI couldn't be shown." }}
    </div>
  </div>
</template>
