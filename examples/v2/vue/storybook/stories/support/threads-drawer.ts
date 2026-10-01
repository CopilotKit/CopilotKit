import { onBeforeUnmount, onMounted, ref } from "vue";
import type { Decorator } from "@storybook/vue3-vite";
import { storyThreads } from "./fixtures";

export { withLicense } from "./providers";

/**
 * Offline helpers for stories that render `<copilotkit-threads-drawer>`
 * (`CopilotThreadsDrawer`, or a popup/sidebar with `threads-drawer`).
 *
 * Thread data normally comes from `useThreads`, which needs a CopilotKit
 * Intelligence runtime, and the locked/unlocked view from the license the
 * runtime reports. These stories pin the license through `LicenseContextKey`
 * and, where a thread list or error is needed, pin those fields on the
 * underlying element. That reaches every visual state; row actions (archive,
 * delete, load more) dispatch but have no backend to act on.
 */

type DrawerElement = HTMLElement & { requestUpdate?: () => void };

export type PinnedDrawerFields = Partial<{
  threads: typeof storyThreads;
  activeThreadId: string;
  error: string;
}>;

/** A thread list with the first thread active. */
export const pinnedThreads: PinnedDrawerFields = {
  threads: storyThreads,
  activeThreadId: storyThreads[0]!.id,
};

/** A failed initial thread fetch. */
export const pinnedError: PinnedDrawerFields = {
  error: "Couldn't load threads.",
};

/**
 * Pins element properties so the wrapper's (empty) store data can't overwrite
 * them. Finds the drawer anywhere under the story, waiting for it to mount
 * (the wrapper loads the element lazily).
 */
export const withPinnedDrawer =
  (pinned: PinnedDrawerFields): Decorator =>
  (story) => ({
    components: { story },
    setup() {
      const root = ref<HTMLElement | null>(null);
      let element: DrawerElement | null = null;
      let frame = 0;

      const pin = () => {
        element =
          root.value?.querySelector<DrawerElement>(
            "copilotkit-threads-drawer",
          ) ?? null;
        if (!element) {
          frame = requestAnimationFrame(pin);
          return;
        }
        for (const [key, value] of Object.entries(pinned)) {
          Object.defineProperty(element, key, {
            configurable: true,
            get: () => value,
            set: () => {},
          });
        }
        element.requestUpdate?.();
      };

      onMounted(pin);
      onBeforeUnmount(() => {
        cancelAnimationFrame(frame);
        if (!element) return;
        for (const key of Object.keys(pinned)) {
          Reflect.deleteProperty(element, key);
        }
      });

      return { root };
    },
    template: `<div ref="root" style="display: contents"><story /></div>`,
  });
