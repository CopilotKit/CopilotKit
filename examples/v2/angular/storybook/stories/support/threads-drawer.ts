import { storyThreads } from "./fixtures";

/**
 * Offline helpers for stories that render `<copilotkit-threads-drawer>`
 * (`<copilot-threads-drawer>`, or a popup/sidebar with `threadsDrawer`).
 *
 * Thread data normally comes from CopilotKit Intelligence (a licensed
 * runtime), which Storybook doesn't have. These helpers pin the element's
 * properties so the Angular wrapper's (empty, still-resolving) data can't
 * overwrite them. That reaches every visual state; row actions dispatch but
 * have no backend to act on. Mirrors the React Storybook's `withPinnedDrawer`.
 */

type DrawerElement = HTMLElement & { requestUpdate?: () => void };

export type PinnedDrawerFields = Partial<{
  threads: typeof storyThreads;
  activeThreadId: string | null;
  error: string | null;
  loading: boolean;
  licensed: boolean;
}>;

/** A thread list with the first thread active. */
export const pinnedThreads: PinnedDrawerFields = {
  threads: storyThreads,
  activeThreadId: storyThreads[0]!.id,
  loading: false,
  licensed: true,
  error: null,
};

export const pinnedEmpty: PinnedDrawerFields = {
  threads: [],
  loading: false,
  licensed: true,
  error: null,
};

export const pinnedLoading: PinnedDrawerFields = {
  threads: [],
  loading: true,
  licensed: true,
  error: null,
};

/** A failed initial thread fetch. */
export const pinnedError: PinnedDrawerFields = {
  threads: [],
  loading: false,
  licensed: true,
  error: "Couldn't load threads.",
};

/** No license that includes threads: the upgrade view. */
export const pinnedLocked: PinnedDrawerFields = {
  threads: [],
  loading: false,
  licensed: false,
  error: null,
};

/**
 * Pins `fields` on the first `<copilotkit-threads-drawer>` under `root`,
 * waiting for it to mount. Resolves with the element.
 */
export function pinDrawer(
  root: ParentNode,
  fields: PinnedDrawerFields,
): Promise<DrawerElement> {
  return new Promise((resolve) => {
    const pin = () => {
      const element = root.querySelector<DrawerElement>(
        "copilotkit-threads-drawer",
      );
      if (!element) {
        requestAnimationFrame(pin);
        return;
      }
      for (const [key, value] of Object.entries(fields)) {
        Object.defineProperty(element, key, {
          configurable: true,
          get: () => value,
          set: () => {},
        });
      }
      element.requestUpdate?.();
      resolve(element);
    };
    pin();
  });
}
