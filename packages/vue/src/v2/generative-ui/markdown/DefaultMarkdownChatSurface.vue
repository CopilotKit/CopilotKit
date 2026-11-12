<script setup lang="ts">
/**
 * The default wrapper of a chat surface in the markdown transport. It draws
 * no box: a surface sits in the flow of the reply like a paragraph, and a
 * Card draws its own box when it is interactive. The default slot is the
 * surface. A rejected operation gets one line. The `#generative-ui-surface`
 * slot of `CopilotChat` replaces it, for both transports.
 *
 * The error line is interpolated, so its text has no leading or trailing
 * space.
 */
import { onBeforeMount } from "vue";
import type { GenerativeUIChatSurfaceProps } from "../chat";

defineOptions({ name: "DefaultMarkdownChatSurface" });
defineProps<GenerativeUIChatSurfaceProps>();
defineSlots<{ default?: () => unknown }>();

const FADE_STYLE_ID = "a2ui-markdown-fade";
/**
 * Components fade in as they stream: each element that appears under a
 * markdown surface runs the keyframes once on mount. Vue keeps the elements
 * per component id, so an element that is already there never animates
 * again. SVG internals are left out: a chart library re-creates its nodes
 * on each render, and a fade on each of them would read as the chart
 * flashing whenever a sibling arrives. The fade runs under reduced motion
 * too, because it moves nothing.
 */
const FADE_CSS = [
  // Opacity only, so it also runs when the user asks for reduced motion.
  // The keyframes give only the start, so each element fades to its own
  // opacity, and no fill holds the end: a finished fade must not pin
  // opacity, or an element that hides itself with opacity stays visible.
  "@keyframes a2ui-fade-in{from{opacity:0}}",
  "[data-a2ui-markdown-surface] .a2ui-surface *:not(svg):not(svg *){animation:a2ui-fade-in .35s ease-out backwards}",
].join("\n");

// Before mount, so nothing is added on the server.
onBeforeMount(() => {
  if (document.getElementById(FADE_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = FADE_STYLE_ID;
  style.textContent = FADE_CSS;
  document.head.appendChild(style);
});
</script>

<template>
  <div
    :data-generative-ui-chat-surface="surfaceId"
    :data-a2ui-markdown-surface="surfaceId"
    class="cpk:relative cpk:my-4 cpk:flex cpk:w-full cpk:min-w-0 cpk:max-w-full cpk:flex-col"
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
