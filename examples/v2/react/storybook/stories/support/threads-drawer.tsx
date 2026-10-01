import React, { useEffect, useRef } from "react";
import type { Decorator } from "@storybook/react-vite";
import { userEvent, within } from "storybook/test";
import { useCopilotChatConfiguration } from "@copilotkit/react-core/v2";
import { storyThreads } from "./fixtures";
import { StoryLicense } from "./providers";

/**
 * Offline helpers for stories that render `<copilotkit-threads-drawer>`
 * (`CopilotThreadsDrawer`, or a popup/sidebar with `threadsDrawer`).
 *
 * Thread data normally comes from `useThreads`, which needs a CopilotKit
 * Intelligence runtime, and the locked/unlocked view from the license the
 * runtime reports. These stories pin the license with a `LicenseContext`
 * provider and, where a thread list or error is needed, pin those fields on
 * the underlying element. That reaches every visual state; row actions
 * (archive, delete, load more) dispatch but have no backend to act on.
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
  error: "Couldn't load conversations.",
};

/**
 * Pins element properties so the wrapper's (empty) store data can't overwrite
 * them. Finds the drawer anywhere under its children, waiting for it to mount
 * (a popup/sidebar loads its drawer lazily).
 */
const ElementFixture: React.FC<{
  pinned: PinnedDrawerFields;
  children: React.ReactNode;
}> = ({ pinned, children }) => {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let element: DrawerElement | null = null;
    let frame = 0;
    const pin = () => {
      element =
        ref.current?.querySelector<DrawerElement>(
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
    pin();
    return () => {
      cancelAnimationFrame(frame);
      if (!element) return;
      for (const key of Object.keys(pinned)) {
        delete (element as unknown as Record<string, unknown>)[key];
      }
      element.requestUpdate?.();
    };
  }, [pinned]);

  return (
    <div ref={ref} className="contents">
      {children}
    </div>
  );
};

/** Decorator form of {@link ElementFixture}. */
export const withPinnedDrawer =
  (pinned: PinnedDrawerFields): Decorator =>
  (Story) => (
    <ElementFixture pinned={pinned}>
      <Story />
    </ElementFixture>
  );

/** Pins the license the runtime would report (`valid` unlocks threads). */
export const withLicense =
  (status: "valid" | "none"): Decorator =>
  (Story) => (
    <StoryLicense status={status}>
      <Story />
    </StoryLicense>
  );

/** A `play` step that opens a popup or sidebar's drawer from its header launcher. */
export async function openThreadsDrawer({
  canvasElement,
}: {
  canvasElement: HTMLElement;
}): Promise<void> {
  await userEvent.click(
    await within(canvasElement).findByTestId("copilot-threads-drawer-launcher"),
  );
}

/**
 * A replacement for the default drawer, passed as `threadsDrawer={...}`. It
 * renders inside the popup/sidebar's chat configuration, which carries the
 * drawer's open state and thread switching; a real one would list threads with
 * `useThreads()` (the stories use fixture threads, having no runtime).
 */
export function StoryCustomThreadsDrawer() {
  const configuration = useCopilotChatConfiguration();
  if (!configuration?.drawerOpen) return null;

  const close = () => configuration.setDrawerOpen(false);
  return (
    <>
      <div
        aria-hidden
        onClick={close}
        style={{
          position: "absolute",
          inset: 0,
          // Above the chat's docked input, like the default drawer.
          zIndex: 50,
          background: "color-mix(in oklab, var(--foreground) 12%, transparent)",
        }}
      />
      <nav
        aria-label="Recent chats"
        style={{
          position: "absolute",
          insetBlock: 0,
          left: 0,
          zIndex: 51,
          width: 240,
          padding: 12,
          display: "flex",
          flexDirection: "column",
          gap: 4,
          background: "var(--card)",
          color: "var(--card-foreground)",
          borderRight: "1px solid var(--border)",
        }}
      >
        <strong style={{ padding: "8px 10px", fontSize: 13 }}>
          Recent chats
        </strong>
        {storyThreads.map((thread) => (
          <button
            key={thread.id}
            type="button"
            onClick={() => {
              configuration.setActiveThreadId(thread.id);
              close();
            }}
            style={{
              textAlign: "left",
              padding: "8px 10px",
              borderRadius: 10,
              fontSize: 13,
              background:
                thread.id === configuration.threadId
                  ? "var(--accent)"
                  : "transparent",
            }}
          >
            {thread.name}
          </button>
        ))}
      </nav>
    </>
  );
}
