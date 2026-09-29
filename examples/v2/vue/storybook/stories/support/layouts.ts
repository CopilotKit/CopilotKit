import { onMounted, onUnmounted } from "vue";
import type { Decorator } from "@storybook/vue3-vite";

/** A centered reading column, the width a chat transcript usually gets. */
export const withMessageColumn: Decorator = (story) => ({
  components: { story },
  template: `<div class="story-column"><story /></div>`,
});

/** A centered stage for small standalone controls (inputs, pills, buttons). */
export const withCenteredStage: Decorator = (story) => ({
  components: { story },
  template: `<div class="story-stage"><div><story /></div></div>`,
});

/**
 * A CopilotKit root (`[data-copilotkit]`) for subcomponents that normally
 * render inside a chat view, so they get CopilotKit's tokens and scoped reset.
 */
export const withCopilotKitRoot: Decorator = (story) => ({
  components: { story },
  template: `<div data-copilotkit><story /></div>`,
});

/** Full-viewport frame for views that manage their own scrolling. */
export const withFullHeight: Decorator = (story) => ({
  components: { story },
  template: `<div class="story-full"><story /></div>`,
});

/**
 * Mounts story-scoped CSS for customization demos and removes it on unmount,
 * so one story's overrides never leak into another.
 */
export const withStyles =
  (css: string): Decorator =>
  (story) => ({
    components: { story },
    setup() {
      let style: HTMLStyleElement | null = null;
      onMounted(() => {
        style = document.createElement("style");
        style.textContent = css;
        document.head.appendChild(style);
      });
      onUnmounted(() => {
        style?.remove();
        style = null;
      });
    },
    template: `<story />`,
  });
